import { expect, test, type BrowserContext, type Page } from "./helpers/live-test";
import { countEventCardsByTitle, E2E_PASSWORD, openCalendarWeek } from "./helpers/calendar-live";
import { api, openUser, OWNER, TEAMMATE } from "./helpers/live-matrix";

/**
 * #1664: changes the owner makes in a shared calendar reach the teammate's
 * open Calendar tab on push, without a reload: create, edit, move and delete
 * over JMAP (another app), then create, edit and delete over CalDAV (a phone
 * or desktop client).
 *
 * Bound: 8 s, inside the 10 s fallback poll. While push is connected that
 * poll runs every 60 s, and the spec runs well within 60 s of push
 * connecting, so a pass proves the push path.
 */

const PUSH_BOUND_MS = 8_000;
const API = process.env.WGW_E2E_API_URL ?? "http://127.0.0.1:9080";
const USING = ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:calendars"];

test.use({ storageState: { cookies: [], origins: [] }, actionTimeout: 15_000 });

test("the owner's changes to a shared calendar reach the teammate's open tab on push", async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const id = `push${Date.now().toString(36)}`;
  const date = wednesdayWeeksAhead(6);
  const calendarId = await createSharedCalendar(`Push ${id}`);
  let context: BrowserContext | null = null;

  try {
    const [edit, move, remove] = await createEvents(calendarId, date, [
      { title: `edit ${id}`, hour: 9 },
      { title: `move ${id}`, hour: 11 },
      { title: `delete ${id}`, hour: 13 },
    ]);

    context = await openUser(browser, TEAMMATE);
    const connected = pushConnected(context);
    const tab = await context.newPage();
    await openCalendarWeek(tab, date);
    await connected;
    for (const title of [edit!.title, move!.title, remove!.title])
      await expect.poll(() => countEventCardsByTitle(tab, title)).toBe(1);
    let navigations = 0;
    tab.on("framenavigated", (frame) => {
      if (frame === tab.mainFrame()) navigations += 1;
    });

    // Over JMAP, the way another app writes.
    const created = `created ${id}`;
    const edited = `edited ${id}`;
    const moveY = await cardY(tab, move!.title);
    let sentAt = Date.now();
    await createEvents(calendarId, date, [{ title: created, hour: 15 }]);
    await updateEvent(edit!.id, { title: edited });
    await updateEvent(move!.id, { start: `${date}T16:00:00` });
    await destroyEvent(remove!.id);
    await expectCount(tab, created, 1, sentAt);
    await expectCount(tab, edited, 1, sentAt);
    await expectCount(tab, edit!.title, 0, sentAt);
    await expect
      .poll(() => cardY(tab, move!.title), { timeout: left(sentAt) })
      .toBeGreaterThan(moveY + 100);
    await expectCount(tab, remove!.title, 0, sentAt);
    const jmapMs = Date.now() - sentAt;

    // Over CalDAV, the way a phone or desktop client writes.
    const davTitle = `caldav ${id}`;
    const davEdited = `caldav edited ${id}`;
    const uid = `${id}-caldav`;
    sentAt = Date.now();
    await putIcs(calendarId, uid, davTitle, date);
    await expectCount(tab, davTitle, 1, sentAt);
    const davCreateMs = Date.now() - sentAt;

    sentAt = Date.now();
    await putIcs(calendarId, uid, davEdited, date);
    await expectCount(tab, davEdited, 1, sentAt);
    await expectCount(tab, davTitle, 0, sentAt);
    const davEditMs = Date.now() - sentAt;

    sentAt = Date.now();
    await dav("DELETE", calendarId, uid);
    await expectCount(tab, davEdited, 0, sentAt);
    const davDeleteMs = Date.now() - sentAt;

    expect(navigations, "the tab never reloaded").toBe(0);
    const latency = `JMAP ${jmapMs} ms; CalDAV create ${davCreateMs} ms, edit ${davEditMs} ms, delete ${davDeleteMs} ms`;
    test.info().annotations.push({ type: "latency", description: latency });
    console.log(`[calendar-push] owner writes → teammate tab: ${latency}`);
  } finally {
    await context?.close();
    await jmap(OWNER, [["Calendar/set", { accountId: OWNER, destroy: [calendarId] }, "d"]]).catch(
      () => undefined,
    );
  }
});

function left(sentAt: number): number {
  return Math.max(1, PUSH_BOUND_MS - (Date.now() - sentAt));
}

async function expectCount(tab: Page, title: string, count: number, sentAt: number) {
  await expect
    .poll(() => countEventCardsByTitle(tab, title), {
      timeout: left(sentAt),
      message: `"${title}" shows ${count} time(s) within ${PUSH_BOUND_MS} ms`,
    })
    .toBe(count);
}

async function cardY(tab: Page, title: string): Promise<number> {
  const box = await tab.locator("event-card").filter({ hasText: title }).first().boundingBox();
  return box?.y ?? Number.NaN;
}

/** A Wednesday inside the calendar's loaded window. */
function wednesdayWeeksAhead(weeks: number): string {
  const date = new Date();
  date.setDate(date.getDate() + weeks * 7 + ((3 - date.getDay() + 7) % 7));
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

type MethodResponse = [string, Record<string, unknown>, string];

async function jmap(user: string, methodCalls: unknown[]): Promise<MethodResponse[]> {
  const res = await api(user, "POST", "/jmap", { using: USING, methodCalls });
  expect(res.status, JSON.stringify(res.json)).toBe(200);
  return (res.json as { methodResponses: MethodResponse[] }).methodResponses;
}

async function setEvents(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const [[, result]] = await jmap(OWNER, [
    ["CalendarEvent/set", { accountId: OWNER, ...args }, "s"],
  ]);
  for (const key of ["notCreated", "notUpdated", "notDestroyed"]) {
    expect(Object.keys(result![key] ?? {}), JSON.stringify(result)).toEqual([]);
  }
  return result!;
}

async function createSharedCalendar(name: string): Promise<string> {
  const [[, result]] = await jmap(OWNER, [
    [
      "Calendar/set",
      {
        accountId: OWNER,
        create: { c: { name, color: "#0ea5e9", shareWith: { [TEAMMATE]: { mayWrite: true } } } },
      },
      "c",
    ],
  ]);
  const created = (result as { created?: { c?: { id: string } } }).created?.c;
  if (!created) throw new Error(`Calendar not created: ${JSON.stringify(result)}`);
  return created.id;
}

async function createEvents(
  calendarId: string,
  date: string,
  rows: { title: string; hour: number }[],
): Promise<{ id: string; title: string }[]> {
  const create = Object.fromEntries(
    rows.map((row, index) => [
      `e${index}`,
      {
        "@type": "Event",
        calendarIds: { [calendarId]: true },
        title: row.title,
        start: `${date}T${String(row.hour).padStart(2, "0")}:00:00`,
        duration: "PT1H",
      },
    ]),
  );
  const result = await setEvents({ create });
  const created = result.created as Record<string, { id: string }>;
  return rows.map((row, index) => ({ id: created[`e${index}`]!.id, title: row.title }));
}

async function updateEvent(eventId: string, patch: Record<string, unknown>): Promise<void> {
  await setEvents({ update: { [eventId]: patch } });
}

async function destroyEvent(eventId: string): Promise<void> {
  await setEvents({ destroy: [eventId] });
}

async function dav(method: string, calendarId: string, uid: string, body?: string) {
  const res = await fetch(`${API}/calendars/${OWNER}/${calendarId}/${uid}.ics`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${OWNER}:${E2E_PASSWORD}`).toString("base64")}`,
      ...(body ? { "Content-Type": "text/calendar; charset=utf-8" } : {}),
    },
    body,
  });
  expect(res.status, `${method} ${uid}.ics: ${await res.text()}`).toBeLessThan(300);
}

/** Create or replace one VEVENT, as a CalDAV client does. */
async function putIcs(calendarId: string, uid: string, title: string, date: string) {
  const day = date.replaceAll("-", "");
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//WGW e2e//calendar-push//EN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`,
    `DTSTART:${day}T170000`,
    `DTEND:${day}T180000`,
    `SUMMARY:${title}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
  await dav("PUT", calendarId, uid, ics);
}

/** Resolves once a push request in any tab of the context got an event stream back. */
function pushConnected(context: BrowserContext): Promise<unknown> {
  return context.waitForEvent("response", {
    predicate: (response) => /\/jmap\/events\//.test(response.url()) && response.status() === 200,
    timeout: 30_000,
  });
}
