import { expect, test, type BrowserContext, type Page } from "./helpers/live-test";
import { countEventCardsByTitle, openCalendarWeek } from "./helpers/calendar-live";
import { api, openUser, OWNER } from "./helpers/live-matrix";

/**
 * #2256: a first load that finishes late does not undo what inbound sync
 * stored in the meantime.
 *
 * Tab A is open and syncs. Tab B opens: the server answers its event lists,
 * and the spec holds those answers. A second device then creates, edits and
 * deletes an event, and tab A stores all three in the cache both tabs share.
 * When tab B gets its (now old) lists, it must keep the created event, keep
 * the edit and not bring the deleted event back.
 */

const USING = ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:calendars"];
const SHOWN_MS = 20_000;

test.use({ storageState: { cookies: [], origins: [] }, actionTimeout: 15_000 });

test("a first load that finishes late keeps what a sync round stored meanwhile", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const id = `late${Date.now().toString(36)}`;
  const date = wednesdayWeeksAhead(6);
  const calendarId = await createCalendar(`Late load ${id}`);
  let context: BrowserContext | null = null;

  try {
    const [edit, remove] = await createEvents(calendarId, date, [
      { title: `edit ${id}`, hour: 9 },
      { title: `delete ${id}`, hour: 11 },
    ]);
    const created = `created ${id}`;
    const edited = `edited ${id}`;

    context = await openUser(browser, OWNER);
    const connected = context.waitForEvent("response", {
      predicate: (response) => /\/jmap\/events\//.test(response.url()) && response.status() === 200,
      timeout: 30_000,
    });
    const tabA = await context.newPage();
    await openCalendarWeek(tabA, date);
    await connected;
    for (const title of [edit!.title, remove!.title]) await shows(tabA, title, 1);
    await tabA.waitForTimeout(2_000);

    // Tab B: the server answers each event list now; the tab gets it later.
    const tabB = await context.newPage();
    let release = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = 0;
    await tabB.route(/\/api\/v1\/jmap$/, async (route) => {
      const calls =
        (route.request().postDataJSON() as { methodCalls?: [string, unknown][] } | null)
          ?.methodCalls ?? [];
      if (!calls.some(([name]) => name === "CalendarEvent/query")) return route.continue();
      const response = await route.fetch();
      held += 1;
      await released;
      await route.fulfill({ response });
    });
    await tabB.goto(`/calendar/week/${date}`);
    await expect.poll(() => held, { timeout: 30_000 }).toBeGreaterThan(0);
    await tabB.waitForTimeout(3_000);

    // A second device writes; tab A's sync round stores it in the shared cache.
    await setEvents({
      create: {
        n: {
          "@type": "Event",
          calendarIds: { [calendarId]: true },
          title: created,
          start: `${date}T13:00:00`,
          duration: "PT1H",
        },
      },
    });
    await setEvents({ update: { [edit!.id]: { title: edited } } });
    await setEvents({ destroy: [remove!.id] });
    await shows(tabA, created, 1);
    await shows(tabA, edited, 1);
    await shows(tabA, remove!.title, 0);
    await tabA.waitForTimeout(1_000);

    release();
    await expect(tabB.locator("time-line.timeline-timed")).toBeVisible({ timeout: 30_000 });
    const upToDate = async (tab: Page) => {
      await shows(tab, created, 1);
      await shows(tab, edited, 1);
      await shows(tab, edit!.title, 0);
      await shows(tab, remove!.title, 0);
    };
    await upToDate(tabB);
    // The late lists are written a moment after the first paint: still up to date then.
    await tabB.waitForTimeout(5_000);
    await upToDate(tabB);

    // One more round makes tab A read the shared cache again.
    const last = `last ${id}`;
    await setEvents({
      create: {
        l: {
          "@type": "Event",
          calendarIds: { [calendarId]: true },
          title: last,
          start: `${date}T15:00:00`,
          duration: "PT1H",
        },
      },
    });
    for (const tab of [tabA, tabB]) {
      await shows(tab, last, 1);
      await upToDate(tab);
    }
  } finally {
    await context?.close();
    // With its events: a calendar that still holds events is not destroyed otherwise.
    await jmap([
      [
        "Calendar/set",
        { accountId: OWNER, destroy: [calendarId], onDestroyRemoveEvents: true },
        "d",
      ],
    ]).catch(() => undefined);
  }
});

async function shows(tab: Page, title: string, count: number): Promise<void> {
  await expect
    .poll(() => countEventCardsByTitle(tab, title), {
      timeout: SHOWN_MS,
      message: `"${title}" shows ${count} time(s)`,
    })
    .toBe(count);
}

/** A Wednesday inside the calendar's loaded window. */
function wednesdayWeeksAhead(weeks: number): string {
  const date = new Date();
  date.setDate(date.getDate() + weeks * 7 + ((3 - date.getDay() + 7) % 7));
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

type MethodResponse = [string, Record<string, unknown>, string];

async function jmap(methodCalls: unknown[]): Promise<MethodResponse[]> {
  const res = await api(OWNER, "POST", "/jmap", { using: USING, methodCalls });
  expect(res.status, JSON.stringify(res.json)).toBe(200);
  return (res.json as { methodResponses: MethodResponse[] }).methodResponses;
}

async function setEvents(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const [[, result]] = await jmap([["CalendarEvent/set", { accountId: OWNER, ...args }, "s"]]);
  for (const key of ["notCreated", "notUpdated", "notDestroyed"]) {
    expect(Object.keys(result![key] ?? {}), JSON.stringify(result)).toEqual([]);
  }
  return result!;
}

async function createCalendar(name: string): Promise<string> {
  const [[, result]] = await jmap([
    ["Calendar/set", { accountId: OWNER, create: { c: { name, color: "#0ea5e9" } } }, "c"],
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
