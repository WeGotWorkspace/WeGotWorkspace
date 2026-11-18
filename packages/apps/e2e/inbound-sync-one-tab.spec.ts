import { expect, test, type BrowserContext, type Page } from "./helpers/live-test";
import { countEventCardsByTitle, openCalendarWeek } from "./helpers/calendar-live";
import { createContactCards, destroyContactCards } from "./helpers/contacts-jmap";
import { api, chatMessageId, openUser, OWNER, TEAMMATE } from "./helpers/live-matrix";
import { E2E_NOTEBOOK_ID } from "./helpers/notes-live";

/**
 * #2252: one tab per browser pulls an app's inbound changes; the other tabs
 * of that app re-read the shared cache and send no `/changes` request.
 *
 * Every write comes over the API, like another device, so no tab sees it
 * first. A tab counts as syncing when it sends a JMAP `<Type>/changes` call.
 * Notes also covers the hand-over: the syncing tab closes, and the syncing
 * tab is hidden while push is down.
 */

/** A change must show in every tab within this, on push. */
const PUSH_BOUND_MS = 8_000;
/** With push down the 10 s poll brings it. */
const POLL_BOUND_MS = 20_000;

test.use({ storageState: { cookies: [], origins: [] }, actionTimeout: 15_000 });

test("Notes: one of three tabs syncs, and another takes over when it closes or is hidden", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const run = `one-tab-${Date.now().toString(36)}`;
  const noteIds: string[] = [];
  const context = await openUser(browser, OWNER);
  await allowHiding(context);

  const createNote = async (title: string) => {
    const res = await api(OWNER, "POST", "/notes/items", {
      uid: crypto.randomUUID(),
      notebookId: E2E_NOTEBOOK_ID,
      title,
      body: title,
      categories: [],
    });
    expect(res.status, JSON.stringify(res.json)).toBeLessThan(300);
    noteIds.push((res.json as { id: string }).id);
  };
  const shows = (tab: Page, title: string, timeout: number) =>
    expect(tab.getByText(title, { exact: true }).first()).toBeVisible({ timeout });

  try {
    const connected = pushConnected(context);
    const tabs = [await context.newPage(), await context.newPage(), await context.newPage()];
    const calls = tabs.map((tab) => countChanges(tab, "Note"));
    for (const tab of tabs) await tab.goto("/notes");
    await connected;
    await warmUp(tabs, `${run} warm-up`, createNote, shows);

    // Three tabs: every tab shows the note, one tab asked the server.
    let before = calls.map((count) => count());
    await createNote(`${run} three tabs`);
    await Promise.all(tabs.map((tab) => shows(tab, `${run} three tabs`, PUSH_BOUND_MS)));
    let made = calls.map((count, index) => count() - before[index]!);
    const syncing = made.findIndex((count) => count > 0);
    expect(
      made.filter((count) => count > 0),
      `one syncing tab: ${made}`,
    ).toHaveLength(1);

    // The syncing tab closes: one of the other two takes over.
    await tabs[syncing]!.close();
    const open = tabs.filter((_, index) => index !== syncing);
    const openCalls = calls.filter((_, index) => index !== syncing);
    await open[0]!.waitForTimeout(1_000);
    before = openCalls.map((count) => count());
    await createNote(`${run} after close`);
    await Promise.all(open.map((tab) => shows(tab, `${run} after close`, PUSH_BOUND_MS)));
    made = openCalls.map((count, index) => count() - before[index]!);
    const next = made.findIndex((count) => count > 0);
    expect(
      made.filter((count) => count > 0),
      `one syncing tab after the close: ${made}`,
    ).toHaveLength(1);

    // Push goes down and the syncing tab is hidden: the visible tab polls.
    await context.route(/\/api\/v1\/jmap\/events\//, (route) => route.abort());
    const hidden = open[next]!;
    const visible = open[1 - next]!;
    await hidden.evaluate(() => (window as unknown as HideableWindow).__setHidden(true));
    await visible.waitForTimeout(1_000);
    before = openCalls.map((count) => count());
    await createNote(`${run} hidden owner`);
    await shows(visible, `${run} hidden owner`, POLL_BOUND_MS);
    made = openCalls.map((count, index) => count() - before[index]!);
    expect(made[1 - next], `the visible tab syncs: ${made}`).toBeGreaterThan(0);
    expect(made[next], `the hidden tab does not: ${made}`).toBe(0);
    // The hidden tab reads the cache the visible tab wrote.
    await shows(hidden, `${run} hidden owner`, PUSH_BOUND_MS);
  } finally {
    await context.close();
    for (const id of noteIds) {
      await api(OWNER, "DELETE", `/notes/items/${encodeURIComponent(id)}`).catch(() => undefined);
    }
  }
});

test("Contacts: one of two tabs syncs", async ({ browser }) => {
  test.setTimeout(240_000);
  const run = `onetab${Date.now().toString(36)}`;
  const cardIds: string[] = [];
  const context = await openUser(browser, OWNER);

  const createCard = async (name: string) => {
    cardIds.push(
      ...(await createContactCards([{ addressBookIds: { default: true }, name: { full: name } }])),
    );
  };
  // The list is long and windowed: show only this run's cards. A search typed
  // while the list still loads can be dropped, so it is typed again until it filters.
  const shows = (tab: Page, name: string, timeout: number) =>
    expect(async () => {
      await tab.getByPlaceholder("Search contacts...").fill(run);
      await expect(tab.getByRole("heading", { level: 3, name, exact: true })).toBeVisible({
        timeout: 1_000,
      });
    }).toPass({ timeout });

  try {
    await createCard(`Aa ${run} seed`);
    const connected = pushConnected(context);
    const tabs = [await context.newPage(), await context.newPage()];
    const calls = tabs.map((tab) => countChanges(tab, "ContactCard"));
    for (const tab of tabs) {
      await tab.goto("/contacts/all");
      await shows(tab, `Aa ${run} seed`, 30_000);
    }
    await connected;
    await warmUp(tabs, `Aa ${run} warm-up`, createCard, shows);

    await expectOneSyncingTab(tabs, calls, async () => {
      await createCard(`Aa ${run} two tabs`);
      await Promise.all(tabs.map((tab) => shows(tab, `Aa ${run} two tabs`, PUSH_BOUND_MS)));
    });
  } finally {
    await context.close();
    await destroyContactCards(cardIds);
  }
});

test("Calendar: one of two tabs syncs", async ({ browser }) => {
  test.setTimeout(240_000);
  const run = `onetab${Date.now().toString(36)}`;
  const date = wednesdayWeeksAhead(6);
  const calendarId = await createCalendar(`One tab ${run}`);
  const context = await openUser(browser, OWNER);
  let hour = 8;

  const createEvent = async (title: string) => {
    hour += 1;
    await calendarJmap("CalendarEvent/set", {
      create: {
        e: {
          "@type": "Event",
          calendarIds: { [calendarId]: true },
          title,
          start: `${date}T${String(hour).padStart(2, "0")}:00:00`,
          duration: "PT1H",
        },
      },
    });
  };
  const shows = (tab: Page, title: string, timeout: number) =>
    expect.poll(() => countEventCardsByTitle(tab, title), { timeout }).toBe(1);

  try {
    const connected = pushConnected(context);
    const tabs = [await context.newPage(), await context.newPage()];
    const calls = tabs.map((tab) => countChanges(tab, "CalendarEvent"));
    for (const tab of tabs) await openCalendarWeek(tab, date);
    await connected;
    await warmUp(tabs, `warm-up ${run}`, createEvent, shows);

    await expectOneSyncingTab(tabs, calls, async () => {
      await createEvent(`two tabs ${run}`);
      await Promise.all(tabs.map((tab) => shows(tab, `two tabs ${run}`, PUSH_BOUND_MS)));
    });
  } finally {
    await context.close();
    await calendarJmap("Calendar/set", { destroy: [calendarId] }).catch(() => undefined);
  }
});

test("Meet chat: one of two tabs syncs", async ({ browser }) => {
  test.setTimeout(240_000);
  const run = `onetab${Date.now().toString(36)}`;
  const dm = await api(OWNER, "POST", "/chat/dms", { principal: TEAMMATE });
  expect([200, 201], JSON.stringify(dm.json)).toContain(dm.status);
  const channelId = (dm.json as { id: string }).id;
  const context = await openUser(browser, TEAMMATE);

  // The owner posts over the API: no browser of the owner, so no mesh preview.
  const post = async (body: string) => {
    const res = await api(
      OWNER,
      "POST",
      `/chat/channels/${encodeURIComponent(channelId)}/messages`,
      { id: chatMessageId(), body },
    );
    expect([200, 201], JSON.stringify(res.json)).toContain(res.status);
  };
  const shows = (tab: Page, body: string, timeout: number) =>
    expect(tab.getByText(body, { exact: true }).first()).toBeVisible({ timeout });

  try {
    const connected = pushConnected(context);
    const tabs = [await context.newPage(), await context.newPage()];
    const calls = tabs.map((tab) => countChanges(tab, "ChatMessage"));
    for (const tab of tabs) await tab.goto(`/meet/dms/${OWNER}`);
    await connected;
    await warmUp(tabs, `${run} warm-up`, post, shows);

    await expectOneSyncingTab(tabs, calls, async () => {
      await post(`${run} two tabs`);
      await Promise.all(tabs.map((tab) => shows(tab, `${run} two tabs`, PUSH_BOUND_MS)));
    });
  } finally {
    await context.close();
  }
});

type Shows = (tab: Page, text: string, timeout: number) => Promise<void>;

/**
 * Writes until every tab shows a write: after that each tab's first load is
 * done and its adapter has taken its seat. A write that lands during a tab's
 * first load can be missed for a reason that is not this spec's subject (the
 * load fetched its list before the write and stores it after), so it is
 * tried again.
 */
async function warmUp(
  tabs: Page[],
  text: string,
  write: (text: string) => Promise<void>,
  shows: Shows,
): Promise<void> {
  await expect(async () => {
    await tabs[0]!.waitForTimeout(3_000);
    const attempt = `${text} ${Date.now().toString(36)}`;
    await write(attempt);
    await Promise.all(tabs.map((tab) => shows(tab, attempt, 10_000)));
  }).toPass({ timeout: 90_000 });
  await tabs[0]!.waitForTimeout(1_000);
}

/** Runs `change` (a write every tab then shows) and checks that one tab asked the server. */
async function expectOneSyncingTab(
  tabs: Page[],
  calls: Array<() => number>,
  change: () => Promise<void>,
): Promise<void> {
  const before = calls.map((count) => count());
  await change();
  const made = calls.map((count, index) => count() - before[index]!);
  expect(
    made.filter((count) => count > 0),
    `one syncing tab of ${tabs.length}: ${made}`,
  ).toHaveLength(1);
}

/** Counts this tab's JMAP `<type>/changes` calls: the push round or the fallback poll. */
function countChanges(tab: Page, type: string): () => number {
  let count = 0;
  tab.on("request", (request) => {
    if (!request.url().endsWith("/api/v1/jmap")) return;
    const calls = (request.postDataJSON() as { methodCalls?: unknown[][] } | null)?.methodCalls;
    if ((calls ?? []).some((call) => call[0] === `${type}/changes`)) count += 1;
  });
  return () => count;
}

function pushConnected(context: BrowserContext): Promise<unknown> {
  return context.waitForEvent("response", {
    predicate: (response) => /\/jmap\/events\//.test(response.url()) && response.status() === 200,
    timeout: 30_000,
  });
}

type HideableWindow = { __setHidden: (hidden: boolean) => void };

/** Every Playwright page counts as visible; this lets a test put one in the background. */
async function allowHiding(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    let hidden = false;
    Object.defineProperty(Document.prototype, "hidden", {
      configurable: true,
      get: () => hidden,
    });
    Object.defineProperty(Document.prototype, "visibilityState", {
      configurable: true,
      get: () => (hidden ? "hidden" : "visible"),
    });
    (window as unknown as HideableWindow).__setHidden = (value) => {
      hidden = value;
      document.dispatchEvent(new Event("visibilitychange"));
    };
  });
}

async function calendarJmap(
  method: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await api(OWNER, "POST", "/jmap", {
    using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:calendars"],
    methodCalls: [[method, { accountId: OWNER, ...args }, "c"]],
  });
  expect(res.status, JSON.stringify(res.json)).toBe(200);
  const [[, result]] = (res.json as { methodResponses: [string, Record<string, unknown>][] })
    .methodResponses;
  expect(Object.keys(result!.notCreated ?? {}), JSON.stringify(result)).toEqual([]);
  return result!;
}

async function createCalendar(name: string): Promise<string> {
  const result = await calendarJmap("Calendar/set", { create: { c: { name, color: "#0ea5e9" } } });
  const created = (result.created as { c?: { id: string } } | undefined)?.c;
  if (!created) throw new Error(`Calendar not created: ${JSON.stringify(result)}`);
  return created.id;
}

function wednesdayWeeksAhead(weeks: number): string {
  const date = new Date();
  date.setDate(date.getDate() + weeks * 7 + ((3 - date.getDay() + 7) % 7));
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
