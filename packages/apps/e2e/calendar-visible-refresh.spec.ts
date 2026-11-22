import { expect, test, type BrowserContext, type Request } from "./helpers/live-test";
import { countEventCardsByTitle, openCalendarWeek } from "./helpers/calendar-live";
import { api, openUser, OWNER, TEAMMATE } from "./helpers/live-matrix";

/**
 * #2287: a Calendar tab that was hidden while another client changed a shared
 * calendar shows the change once it is visible again, with push connected,
 * without a reload and without a full calendar bootstrap (the tab re-reads
 * the cache that live inbound sync keeps current).
 */

const SHOW_BOUND_MS = 8_000;
const USING = ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:calendars"];

test.use({ storageState: { cookies: [], origins: [] }, actionTimeout: 15_000 });

test("a hidden Calendar tab shows changes made meanwhile when it is shown again", async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const id = `vis${Date.now().toString(36)}`;
  const date = wednesdayWeeksAhead(6);
  const calendarId = await createSharedCalendar(`Visible ${id}`);
  let context: BrowserContext | null = null;

  try {
    const [rename] = await createEvents(calendarId, date, [{ title: `rename ${id}`, hour: 9 }]);

    context = await openUser(browser, TEAMMATE);
    const connected = context.waitForEvent("response", {
      predicate: (response) => /\/jmap\/events\//.test(response.url()) && response.status() === 200,
      timeout: 30_000,
    });
    const tab = await context.newPage();
    await openCalendarWeek(tab, date);
    await connected;
    await expect.poll(() => countEventCardsByTitle(tab, rename!.title)).toBe(1);
    let navigations = 0;
    tab.on("framenavigated", (frame) => {
      if (frame === tab.mainFrame()) navigations += 1;
    });

    // A second tab on the same account takes the front: the Calendar tab is hidden.
    const other = await context.newPage();
    await other.goto("about:blank");
    await other.bringToFront();

    const created = `created ${id}`;
    const renamed = `renamed ${id}`;
    await createEvents(calendarId, date, [{ title: created, hour: 13 }]);
    await setEvents({ update: { [rename!.id]: { title: renamed } } });

    const bootstraps: string[] = [];
    const onRequest = (request: Request) => {
      if (request.method() !== "POST" || !/\/jmap$/.test(request.url())) return;
      const body = request.postData() ?? "";
      if (body.includes('"CalendarEvent/query"')) bootstraps.push(body.slice(0, 200));
    };
    tab.on("request", onRequest);
    await tab.bringToFront();
    await tab.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    const shownAt = Date.now();
    const left = () => Math.max(1, SHOW_BOUND_MS - (Date.now() - shownAt));
    await expect.poll(() => countEventCardsByTitle(tab, created), { timeout: left() }).toBe(1);
    await expect.poll(() => countEventCardsByTitle(tab, renamed), { timeout: left() }).toBe(1);
    await expect.poll(() => countEventCardsByTitle(tab, rename!.title)).toBe(0);
    tab.off("request", onRequest);

    expect(navigations, "the tab never reloaded").toBe(0);
    expect(bootstraps, "full calendar bootstrap after the tab was shown").toEqual([]);
  } finally {
    await context?.close();
    await jmap([["Calendar/set", { accountId: OWNER, destroy: [calendarId] }, "d"]]).catch(
      () => undefined,
    );
  }
});

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

async function createSharedCalendar(name: string): Promise<string> {
  const [[, result]] = await jmap([
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
