import { expect, test, type BrowserContext } from "./helpers/live-test";
import { countEventCardsByTitle, openCalendarWeek } from "./helpers/calendar-live";
import { api, openUser, OWNER } from "./helpers/live-matrix";

/**
 * #2257: a delete that lands in the middle of a sync round is not skipped.
 *
 * One round is `CalendarEvent/changes` followed by `CalendarEvent/get` for the
 * changed ids. The spec holds the tab's get, deletes another event as a second
 * device and lets the get go. The get's answer carries the state after the
 * delete. The tab must keep the state of the changes answer as its cursor, so
 * the next round (on the delete's push) reports the delete.
 */

const USING = ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:calendars"];
const NEXT_ROUND_MS = 20_000;

test.use({ storageState: { cookies: [], origins: [] }, actionTimeout: 15_000 });

test("a delete between the changes and the get of one round is removed by the next round", async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const id = `midround${Date.now().toString(36)}`;
  const date = wednesdayWeeksAhead(6);
  const calendarId = await createCalendar(`Mid round ${id}`);
  let context: BrowserContext | null = null;

  try {
    const [edit, remove] = await createEvents(calendarId, date, [
      { title: `edit ${id}`, hour: 9 },
      { title: `delete ${id}`, hour: 13 },
    ]);

    context = await openUser(browser, OWNER);
    const connected = context.waitForEvent("response", {
      predicate: (response) => /\/jmap\/events\//.test(response.url()) && response.status() === 200,
      timeout: 30_000,
    });
    const tab = await context.newPage();
    await openCalendarWeek(tab, date);
    await connected;
    for (const title of [edit!.title, remove!.title])
      await expect.poll(() => countEventCardsByTitle(tab, title)).toBe(1);
    // The first load is done: from here a get for explicit ids is a sync round's.
    await tab.waitForTimeout(2_000);

    let deletedMidRound = false;
    await context.route(/\/api\/v1\/jmap$/, async (route) => {
      const calls =
        (route.request().postDataJSON() as { methodCalls?: [string, { ids?: unknown }][] } | null)
          ?.methodCalls ?? [];
      const roundGet = calls.some(
        ([name, args]) => name === "CalendarEvent/get" && Array.isArray(args.ids),
      );
      if (roundGet && !deletedMidRound) {
        deletedMidRound = true;
        await setEvents({ destroy: [remove!.id] });
      }
      await route.continue();
    });

    const edited = `edited ${id}`;
    await setEvents({ update: { [edit!.id]: { title: edited } } });

    await expect
      .poll(() => countEventCardsByTitle(tab, edited), { timeout: NEXT_ROUND_MS })
      .toBe(1);
    expect(deletedMidRound, "the delete landed between the changes and the get").toBe(true);
    await expect
      .poll(() => countEventCardsByTitle(tab, remove!.title), {
        timeout: NEXT_ROUND_MS,
        message: "the next round removes the event deleted mid-round",
      })
      .toBe(0);
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
