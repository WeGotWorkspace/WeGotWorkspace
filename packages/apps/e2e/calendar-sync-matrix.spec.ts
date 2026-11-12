// Calendar sync matrix (live app, #1565). The inbound side of the open Calendar
// tab: events changed elsewhere (over JMAP, as another app or a phone would) reach
// the tab's cache through `CalendarEvent/changes`, an expired change log falls
// back to a full list of the loaded window, and a queued local edit is a conflict
// only when the same event changed elsewhere.
//
// The tab pulls changes on push, and on its fallback poll. Its token is the JMAP
// client's state in memory, set when the window loaded; a reload lists the whole
// window again (the bootstrap), so these cases keep the tab open. A write is held
// in the queue while the tab stays online by failing its request at the network,
// which is what a flaky connection does. Run one case with --grep "token".
import { expect, test, type Request, type Route } from "./helpers/live-test";
import {
  countEventCardsByTitle,
  openCalendarWeek,
  resizeEventCardEnd,
} from "./helpers/calendar-live";
import { api, openUser, OWNER, setTabOffline, sleep, type Tab } from "./helpers/live-matrix";

const MIRROR_MS = 30_000;
const USING = ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:calendars"];

test.use({ storageState: { cookies: [], origins: [] }, actionTimeout: 15_000 });

// --- server -------------------------------------------------------------------------------------

type Call = [string, Record<string, unknown>, string];

async function jmap(methodCalls: Call[]): Promise<Call[]> {
  const res = await api(OWNER, "POST", "/jmap", { using: USING, methodCalls });
  if (res.status !== 200) throw new Error(`JMAP ${res.status}: ${JSON.stringify(res.json)}`);
  const responses = (res.json as { methodResponses: Call[] }).methodResponses;
  for (const [method, args] of responses) {
    const failed = args.notCreated ?? args.notUpdated ?? args.notDestroyed;
    if (method === "error" || (failed && Object.keys(failed).length > 0)) {
      throw new Error(`${method}: ${JSON.stringify(args)}`);
    }
  }
  return responses;
}

/** A calendar of its own per case, so the case's events are easy to find and drop. */
async function createCalendar(caseId: string): Promise<string> {
  const [[, set]] = await jmap([
    [
      "Calendar/set",
      { accountId: OWNER, create: { c: { name: `Matrix ${caseId}`, color: "#0ea5e9" } } },
      "c",
    ],
  ]);
  return (set.created as Record<string, { id: string }>).c!.id;
}

/** Events `<name> <caseId>`, one hour each from 09:00 on `date`; ids by name. */
async function seed(
  calendarId: string,
  caseId: string,
  date: string,
  names: string[],
  firstHour = 9,
): Promise<Record<string, string>> {
  const create = Object.fromEntries(
    names.map((name, index) => [
      name,
      {
        "@type": "Event",
        calendarIds: { [calendarId]: true },
        title: `${name} ${caseId}`,
        start: `${date}T${String(firstHour + index * 2).padStart(2, "0")}:00:00`,
        duration: "PT1H",
      },
    ]),
  );
  const [[, set]] = await jmap([["CalendarEvent/set", { accountId: OWNER, create }, "c"]]);
  const created = set.created as Record<string, { id: string }>;
  return Object.fromEntries(names.map((name) => [name, created[name]!.id]));
}

async function renameElsewhere(id: string, name: string, caseId: string): Promise<void> {
  await jmap([
    [
      "CalendarEvent/set",
      { accountId: OWNER, update: { [id]: { title: `${name} ${caseId}` } } },
      "u",
    ],
  ]);
}

async function deleteElsewhere(id: string): Promise<void> {
  await jmap([["CalendarEvent/set", { accountId: OWNER, destroy: [id] }, "d"]]);
}

type ServerEvent = { id: string; title: string; duration: string };

/** The case calendar's events on the server, sorted by title. */
async function serverEvents(calendarId: string): Promise<ServerEvent[]> {
  const [, [, got]] = await jmap([
    ["CalendarEvent/query", { accountId: OWNER, filter: { inCalendars: [calendarId] } }, "q"],
    [
      "CalendarEvent/get",
      {
        accountId: OWNER,
        "#ids": { resultOf: "q", name: "CalendarEvent/query", path: "/ids" },
        properties: ["title", "duration"],
      },
      "g",
    ],
  ]);
  return (got.list as ServerEvent[]).sort((a, b) => a.title.localeCompare(b.title));
}

async function serverTitles(calendarId: string): Promise<string[]> {
  return (await serverEvents(calendarId)).map((event) => event.title);
}

async function dropCalendar(calendarId: string): Promise<void> {
  await jmap([
    ["Calendar/set", { accountId: OWNER, destroy: [calendarId], onDestroyRemoveEvents: true }, "d"],
  ]).catch(() => undefined);
}

// --- the tab ------------------------------------------------------------------------------------

type CachedEvent = { id: string; title: string; duration: string; pending: boolean };
type TabCache = { events: CachedEvent[]; outbox: string[] };

/** The tab's cached events of one calendar, sorted by title, and its Calendar outbox. */
async function tabCache(tab: Tab, calendarId: string): Promise<TabCache> {
  return tab.evaluate(async (calendar) => {
    const user = localStorage.getItem("wgw.offline.calendars.username");
    const empty = { events: [], outbox: [] };
    if (!user) return empty;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(`wgw-offline-${user.trim().toLowerCase()}`);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (![...db.objectStoreNames].includes("calendars_events")) {
      db.close();
      return empty;
    }
    const all = <T>(store: string) =>
      new Promise<T[]>((resolve) => {
        const request = db.transaction(store).objectStore(store).getAll();
        request.onsuccess = () => resolve(request.result as T[]);
        request.onerror = () => resolve([]);
      });
    const events = (
      await all<{ id: string; calendarId: string; data: string; pendingSync: boolean }>(
        "calendars_events",
      )
    )
      .filter((row) => row.calendarId === calendar)
      .map((row) => {
        const event = JSON.parse(row.data) as { title?: string; duration?: string };
        return {
          id: row.id,
          title: event.title ?? "",
          duration: event.duration ?? "",
          pending: row.pendingSync,
        };
      })
      .sort((a, b) => a.title.localeCompare(b.title));
    const outbox = (await all<{ domain: string; op: string }>("outbox"))
      .filter((row) => row.domain === "calendars")
      .map((row) => row.op);
    db.close();
    return { events, outbox };
  }, calendarId);
}

const pollCache = (
  tab: Tab,
  calendarId: string,
  pick: (cache: TabCache) => unknown,
  message: string,
) =>
  expect.poll(async () => pick(await tabCache(tab, calendarId)), {
    message,
    timeout: MIRROR_MS,
    intervals: [1_000],
  });

const titles = (cache: TabCache) =>
  cache.events.map((event) => `${event.title}${event.pending ? " (queued)" : ""}`);

function methodCalls(request: Request): Call[] {
  if (!request.url().endsWith("/jmap") || request.method() !== "POST") return [];
  try {
    return (JSON.parse(request.postData() ?? "{}") as { methodCalls?: Call[] }).methodCalls ?? [];
  } catch {
    return [];
  }
}

/** The tab's `CalendarEvent/changes` and window lists since now. */
function watchPulls(tab: Tab) {
  const calls = { sinces: [] as string[], fullLists: 0 };
  // `requestfinished`: an aborted request applies nothing.
  tab.on("requestfinished", (request) => {
    for (const [name, args] of methodCalls(request)) {
      if (name === "CalendarEvent/changes") calls.sinces.push(String(args.sinceState));
      const filter = args.filter as { after?: string } | undefined;
      if (name === "CalendarEvent/query" && filter?.after) calls.fullLists += 1;
    }
  });
  return calls;
}

/** Answers the tab's next `CalendarEvent/changes` with `cannotCalculateChanges`. */
async function expireChangeLogOnce(tab: Tab): Promise<() => boolean> {
  let answered = false;
  const handler = async (route: Route) => {
    const calls = methodCalls(route.request());
    const changes = calls.find(([name]) => name === "CalendarEvent/changes");
    if (answered || !changes || calls.length !== 1) return route.fallback();
    answered = true;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        methodResponses: [["error", { type: "cannotCalculateChanges" }, changes[2]]],
        sessionState: "matrix",
      }),
    });
  };
  await tab.route("**/jmap", handler);
  return () => answered;
}

/** Fails every event write at the network until released, so it stays queued. */
async function holdWrites(tab: Tab): Promise<() => Promise<void>> {
  const handler = (route: Route) =>
    methodCalls(route.request()).some(([name]) => name === "CalendarEvent/set")
      ? route.abort("failed")
      : route.fallback();
  await tab.route("**/jmap", handler);
  return () => tab.unroute("**/jmap", handler);
}

async function reconnect(tab: Tab): Promise<void> {
  await setTabOffline(tab, true);
  await sleep(1_500);
  await setTabOffline(tab, false);
}

async function openCalendarTab(
  context: Awaited<ReturnType<typeof openUser>>,
  date: string,
): Promise<Tab> {
  const tab = (await context.newPage()) as Tab;
  tab.tag = "A";
  tab.user = OWNER;
  await openCalendarWeek(tab, date);
  return tab;
}

const conflictDialog = (tab: Tab) => tab.getByRole("dialog", { name: /conflict/i });

/** A case id: letters only. */
function caseId(): string {
  return `Cal${Array.from({ length: 6 }, () =>
    String.fromCharCode(97 + Math.floor(Math.random() * 26)),
  ).join("")}`;
}

/** A Wednesday a few weeks ahead: inside the loaded window, clear of today's events. */
function wednesdayWeeksAhead(weeks: number): string {
  const date = new Date();
  date.setDate(date.getDate() + weeks * 7 + ((3 - date.getDay() + 7) % 7));
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const DATE = wednesdayWeeksAhead(5);

// --- the matrix ---------------------------------------------------------------------------------

test.describe("calendar inbound", () => {
  test.describe.configure({ timeout: 180_000 });

  test("token · changes elsewhere arrive through CalendarEvent/changes in the open tab", async ({
    browser,
  }) => {
    const id = caseId();
    const calendarId = await createCalendar(id);
    const context = await openUser(browser, OWNER);
    try {
      const events = await seed(calendarId, id, DATE, ["Ann", "Bob", "Cy"]);
      const tab = await openCalendarTab(context, DATE);
      await pollCache(tab, calendarId, titles, "the tab loads").toEqual([
        `Ann ${id}`,
        `Bob ${id}`,
        `Cy ${id}`,
      ]);
      let navigations = 0;
      tab.on("framenavigated", (frame) => {
        if (frame === tab.mainFrame()) navigations += 1;
      });
      const calls = watchPulls(tab);

      await renameElsewhere(events.Ann!, "Anna", id);
      await deleteElsewhere(events.Bob!);
      await seed(calendarId, id, DATE, ["Dee"], 16);

      await pollCache(tab, calendarId, titles, "the cache mirrors").toEqual([
        `Anna ${id}`,
        `Cy ${id}`,
        `Dee ${id}`,
      ]);
      expect(await serverTitles(calendarId)).toEqual([`Anna ${id}`, `Cy ${id}`, `Dee ${id}`]);
      expect(calls.sinces.length, "pulled through /changes").toBeGreaterThan(0);
      expect(calls.fullLists, "no full list").toBe(0);
      expect(navigations, "the tab never reloaded").toBe(0);
      for (const [title, count] of [
        [`Anna ${id}`, 1],
        [`Ann ${id}`, 0],
        [`Bob ${id}`, 0],
        [`Dee ${id}`, 1],
      ] as const) {
        await expect
          .poll(() => countEventCardsByTitle(tab, title), { message: `the grid shows ${title}` })
          .toBe(count);
      }
    } finally {
      await context.close();
      await dropCalendar(calendarId);
    }
  });

  test("full list · an expired change log re-lists the window and keeps a queued edit", async ({
    browser,
  }) => {
    const id = caseId();
    const calendarId = await createCalendar(id);
    const context = await openUser(browser, OWNER);
    try {
      const events = await seed(calendarId, id, DATE, ["Ann", "Bob"]);
      const tab = await openCalendarTab(context, DATE);
      await pollCache(tab, calendarId, (c) => c.events.length, "the tab loads").toBe(2);

      const release = await holdWrites(tab);
      await resizeEventCardEnd(tab, `Bob ${id}`);
      await pollCache(tab, calendarId, (c) => c.outbox, "the edit is queued").toEqual(["update"]);
      const queued = (await tabCache(tab, calendarId)).events.find((e) => e.id === events.Bob);
      expect(queued?.duration, "the resize changed the duration").not.toBe("PT1H");

      const expired = await expireChangeLogOnce(tab);
      const calls = watchPulls(tab);
      await renameElsewhere(events.Ann!, "Anna", id);

      await pollCache(tab, calendarId, titles, "the full list lands").toEqual([
        `Anna ${id}`,
        `Bob ${id} (queued)`,
      ]);
      expect(expired(), "the change log was expired once").toBe(true);
      expect(calls.fullLists, "the window was listed in full").toBeGreaterThan(0);
      const kept = (await tabCache(tab, calendarId)).events.find((e) => e.id === events.Bob);
      expect(kept?.duration, "the queued edit is kept").toBe(queued?.duration);

      await release();
      await reconnect(tab);
      await expect
        .poll(
          async () => (await serverEvents(calendarId)).find((e) => e.id === events.Bob)?.duration,
          { message: "the queued edit lands", timeout: MIRROR_MS },
        )
        .toBe(queued?.duration);
      await pollCache(tab, calendarId, (c) => c.outbox, "the queue is empty").toEqual([]);
    } finally {
      await context.close();
      await dropCalendar(calendarId);
    }
  });

  test("full list · an expired change log drops an event deleted elsewhere", async ({
    browser,
  }) => {
    // Known gap (#1565, Calendar chunk G): the open tab's full list removes nothing
    // yet; the event deleted elsewhere goes on the next reload. Flip when it lands.
    test.fail();
    const id = caseId();
    const calendarId = await createCalendar(id);
    const context = await openUser(browser, OWNER);
    try {
      const events = await seed(calendarId, id, DATE, ["Ann", "Bob"]);
      const tab = await openCalendarTab(context, DATE);
      await pollCache(tab, calendarId, (c) => c.events.length, "the tab loads").toBe(2);

      const expired = await expireChangeLogOnce(tab);
      await deleteElsewhere(events.Ann!);
      await renameElsewhere(events.Bob!, "Bobby", id);
      await pollCache(tab, calendarId, titles, "the edit lands").toContain(`Bobby ${id}`);
      expect(expired()).toBe(true);

      await pollCache(tab, calendarId, titles, "the deleted event is gone").toEqual([
        `Bobby ${id}`,
      ]);
    } finally {
      await context.close();
      await dropCalendar(calendarId);
    }
  });

  test("conflict · a queued edit and an edit elsewhere since", async ({ browser }) => {
    const id = caseId();
    const calendarId = await createCalendar(id);
    const context = await openUser(browser, OWNER);
    try {
      const events = await seed(calendarId, id, DATE, ["Ann", "Bob"]);
      const tab = await openCalendarTab(context, DATE);
      await pollCache(tab, calendarId, (c) => c.events.length, "the tab loads").toBe(2);

      const release = await holdWrites(tab);
      await resizeEventCardEnd(tab, `Ann ${id}`);
      await pollCache(tab, calendarId, (c) => c.outbox, "the edit is queued").toEqual(["update"]);
      const mine = (await tabCache(tab, calendarId)).events.find((e) => e.id === events.Ann);
      const calls = watchPulls(tab);
      await renameElsewhere(events.Ann!, "Theirs", id);

      await expect(conflictDialog(tab), "the changed event is a conflict").toBeVisible({
        timeout: MIRROR_MS,
      });
      expect(calls.sinces.length, "found through /changes").toBeGreaterThan(0);
      const kept = (await tabCache(tab, calendarId)).events.find((e) => e.id === events.Ann);
      expect([kept?.title, kept?.duration, kept?.pending], "the local edit is kept").toEqual([
        `Ann ${id}`,
        mine?.duration,
        true,
      ]);

      await release();
      await conflictDialog(tab)
        .getByRole("button", { name: /Keep mine/ })
        .click();
      await expect(conflictDialog(tab)).toHaveCount(0, { timeout: 15_000 });
      await expect
        .poll(
          async () => (await serverEvents(calendarId)).find((e) => e.id === events.Ann)?.duration,
          { message: "keep mine lands", timeout: MIRROR_MS },
        )
        .toBe(mine?.duration);
    } finally {
      await context.close();
      await dropCalendar(calendarId);
    }
  });

  test("no conflict · a queued edit whose event did not change elsewhere", async ({ browser }) => {
    const id = caseId();
    const calendarId = await createCalendar(id);
    const context = await openUser(browser, OWNER);
    try {
      const events = await seed(calendarId, id, DATE, ["Ann", "Bob"]);
      const tab = await openCalendarTab(context, DATE);
      await pollCache(tab, calendarId, (c) => c.events.length, "the tab loads").toBe(2);

      const release = await holdWrites(tab);
      await resizeEventCardEnd(tab, `Ann ${id}`);
      await pollCache(tab, calendarId, (c) => c.outbox, "the edit is queued").toEqual(["update"]);
      const mine = (await tabCache(tab, calendarId)).events.find((e) => e.id === events.Ann);
      // Another event in the same calendar changes.
      await renameElsewhere(events.Bob!, "Bobby", id);

      await pollCache(
        tab,
        calendarId,
        titles,
        "the other event's change lands, the queued edit stays",
      ).toEqual([`Ann ${id} (queued)`, `Bobby ${id}`]);
      await sleep(5_000);
      await expect(conflictDialog(tab), "no conflict").toHaveCount(0);

      await release();
      await reconnect(tab);
      await expect
        .poll(
          async () => (await serverEvents(calendarId)).find((e) => e.id === events.Ann)?.duration,
          { message: "the queued edit lands", timeout: MIRROR_MS },
        )
        .toBe(mine?.duration);
      await pollCache(tab, calendarId, (c) => c.outbox, "the queue is empty").toEqual([]);
      expect(await serverTitles(calendarId)).toEqual([`Ann ${id}`, `Bobby ${id}`]);
    } finally {
      await context.close();
      await dropCalendar(calendarId);
    }
  });
});
