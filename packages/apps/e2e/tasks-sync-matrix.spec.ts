// Tasks sync matrix (live app). Two parts, each case with its own lists and
// tasks (named after the case id):
//
// 1. Every action × tab setup × connectivity case. Tab A does the action in
//    the UI. After the reconnect, the server holds the change, every tab
//    mirrors the server in its cache, its "All Tasks" view and its sidebar, and
//    that still holds after a hard refresh of every tab. Each case also keeps a
//    bystander task on a second list, which no action may lose.
//    Tabs:  one · same (two tabs of one browser, one cache) · device (two
//           browsers of the same user, two caches).
//    Net:   on · off (one tab) · both · aOff (actor offline) · bOff (other tab offline).
//
// 2. Inbound (#1565): changes made elsewhere (through the REST API, as a phone
//    or a CalDAV client would) against the changes token, the full-list
//    fallback, queued writes that a re-list must keep, the conflict check, and
//    list deletes.
//
// A write is held in the queue while the tab stays online by failing its
// request at the network (`holdRequests`), which is what a flaky connection
// does. Run one case with --grep "rename · same · aOff".
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Locator,
  type Route,
} from "@playwright/test";
import {
  cleanUpCase,
  conflictDialog,
  converge,
  createList,
  createTask,
  deleteList,
  deleteTask,
  openTasksTab,
  openUser,
  OWNER,
  patchTask,
  POLL_MS,
  serverState,
  setStoredToken,
  setTabOffline,
  showAllTasks,
  sleep,
  tabCache,
  waitForTasks,
  type ServerState,
  type Tab,
} from "./helpers/tasks-matrix";

type Tabs = "one" | "same" | "device";
type Net = "on" | "off" | "both" | "aOff" | "bOff";

const NETS: Record<Tabs, Net[]> = {
  one: ["on", "off"],
  same: ["on", "both", "aOff", "bOff"],
  device: ["on", "both", "aOff", "bOff"],
};

/** Two writes in one go: only where a queue can reorder them (actor offline). */
const COMPOUND_NETS: Record<Tabs, Net[]> = { one: ["off"], same: ["aOff"], device: ["aOff"] };

/** Long enough for one poll in every tab plus a re-list. */
const MIRROR_MS = 2 * POLL_MS + 15_000;

/** Letters only, so a case id never matches a seeded list or task name. */
function caseId(): string {
  return Array.from({ length: 6 }, () =>
    String.fromCharCode(97 + Math.floor(Math.random() * 26)),
  ).join("");
}

type Fixture = {
  id: string;
  /** The case's list ("M <id>") and its id. */
  listA: string;
  listAId: string;
  /** The second list ("M <id> b"): a move target, and home of the bystander task. */
  listB: string;
  listBId: string;
  /** The task the action works on ("T <id>"), when seeded. */
  task: string;
  taskId: string;
};

async function seed(id: string, withTask: boolean): Promise<Fixture> {
  const listA = `M ${id}`;
  const listB = `M ${id} b`;
  const listAId = await createList(listA);
  const listBId = await createList(listB);
  await createTask(listBId, `B ${id}`);
  const task = `T ${id}`;
  const taskId = withTask ? (await createTask(listAId, task)).id : "";
  return { id, listA, listAId, listB, listBId, task, taskId };
}

// --- the actor's steps -------------------------------------------------------------------------

function row(tab: Tab, title: string) {
  return tab.locator(".tasks-main-view__row").filter({
    has: tab.locator(".tasks-main-view__title").getByText(title, { exact: true }),
  });
}

function sidebarList(tab: Tab, name: string) {
  return tab
    .getByRole("region", { name: "My lists" })
    .getByRole("listitem")
    .filter({ has: tab.getByRole("button", { name, exact: true }) });
}

async function pick(tab: Tab, scope: Locator, label: string, name: string) {
  await scope.getByRole("combobox", { name: label }).click();
  await tab.getByRole("option", { name, exact: true }).click();
  await sleep(200);
}

async function addTask(tab: Tab, title: string, list: string) {
  await showAllTasks(tab);
  await tab.getByRole("textbox", { name: "Task name" }).fill(title);
  await pick(tab, tab.locator("body"), "List", list);
  await tab.getByRole("button", { name: "Add task" }).click();
  await row(tab, title).waitFor({ timeout: 15_000 });
  await sleep(2_000);
}

async function openTaskMenu(tab: Tab, title: string, item: "Edit" | "Delete") {
  await showAllTasks(tab);
  const target = row(tab, title);
  await target.hover();
  await target.getByRole("button", { name: "Task actions" }).click();
  await tab.getByRole("menuitem", { name: item, exact: true }).click();
}

async function editTask(tab: Tab, title: string, change: { title?: string; list?: string }) {
  await openTaskMenu(tab, title, "Edit");
  const dialog = tab.getByRole("dialog", { name: "Edit task" });
  await dialog.waitFor({ timeout: 10_000 });
  if (change.title) await dialog.getByRole("textbox", { name: "Task name" }).fill(change.title);
  if (change.list) await pick(tab, dialog, "List", change.list);
  await dialog.getByRole("button", { name: "Save" }).click();
  await dialog.waitFor({ state: "detached", timeout: 10_000 });
  await sleep(2_500);
}

async function openListDialog(tab: Tab, name: string) {
  await sidebarList(tab, name).getByRole("button", { name: "Edit list" }).click();
  const dialog = tab.getByRole("dialog", { name: "Edit list" });
  await dialog.waitFor({ timeout: 10_000 });
  return dialog;
}

const ACTIONS = {
  async create(tab: Tab, f: Fixture) {
    await addTask(tab, `N ${f.id}`, f.listA);
  },
  async rename(tab: Tab, f: Fixture) {
    await editTask(tab, f.task, { title: `${f.task} v2` });
  },
  async complete(tab: Tab, f: Fixture) {
    await showAllTasks(tab);
    await row(tab, f.task).getByRole("checkbox", { name: "Mark complete" }).click();
    await sleep(2_500);
  },
  async delete(tab: Tab, f: Fixture) {
    await openTaskMenu(tab, f.task, "Delete");
    await tab.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
    // The delete waits out its undo delay (2.5 s) before it is sent or queued.
    await sleep(5_000);
  },
  async move(tab: Tab, f: Fixture) {
    await editTask(tab, f.task, { list: f.listB });
  },
  async listCreate(tab: Tab, f: Fixture) {
    await tab.getByRole("button", { name: "More create options" }).click();
    await tab.getByRole("menuitem", { name: "Create list" }).click();
    const dialog = tab.getByRole("dialog", { name: "Create list" });
    await dialog.getByRole("textbox", { name: "List name" }).fill(`M ${f.id} new`);
    await dialog.getByRole("button", { name: "Create" }).click();
    await dialog.waitFor({ state: "detached", timeout: 10_000 });
    await sleep(2_500);
  },
  async listRename(tab: Tab, f: Fixture) {
    const dialog = await openListDialog(tab, f.listA);
    await dialog.getByRole("textbox", { name: "List name" }).fill(`M ${f.id} renamed`);
    await dialog.getByRole("button", { name: "Save" }).click();
    await dialog.waitFor({ state: "detached", timeout: 10_000 });
    await sleep(2_500);
  },
  async listDelete(tab: Tab, f: Fixture) {
    const dialog = await openListDialog(tab, f.listA);
    await dialog.getByRole("button", { name: "Delete list" }).click();
    await tab.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
    await sleep(3_000);
  },
  // Compound: a move and a rename saved together (the dialog sends a move, then a patch).
  async renameMove(tab: Tab, f: Fixture) {
    await editTask(tab, f.task, { title: `${f.task} v2`, list: f.listB });
  },
  // Compound: a new task, renamed before it reached the server.
  async createRename(tab: Tab, f: Fixture) {
    await addTask(tab, `N ${f.id}`, f.listA);
    await editTask(tab, `N ${f.id}`, { title: `N ${f.id} v2` });
  },
} satisfies Record<string, (tab: Tab, f: Fixture) => Promise<void>>;
type Action = keyof typeof ACTIONS;

const COMPOUND: Action[] = ["renameMove", "createRename"];
const SEEDS_TASK: Action[] = ["rename", "complete", "delete", "move", "renameMove"];

const titled = (s: ServerState, title: string) => s.tasks.find((t) => t.title === title);

/** The server once the action landed. */
const LANDED: Record<Action, (s: ServerState, f: Fixture) => boolean> = {
  create: (s, f) => titled(s, `N ${f.id}`)?.listId === f.listAId,
  rename: (s, f) => titled(s, `${f.task} v2`)?.id === f.taskId,
  complete: (s, f) => titled(s, f.task)?.completed === true,
  delete: (s, f) => !s.tasks.some((t) => t.id === f.taskId),
  move: (s, f) => titled(s, f.task)?.listId === f.listBId,
  listCreate: (s, f) => s.lists.some((l) => l.name === `M ${f.id} new`),
  listRename: (s, f) => s.lists.some((l) => l.id === f.listAId && l.name === `M ${f.id} renamed`),
  listDelete: (s, f) => !s.lists.some((l) => l.id === f.listAId),
  renameMove: (s, f) => titled(s, `${f.task} v2`)?.listId === f.listBId,
  createRename: (s, f) =>
    titled(s, `N ${f.id} v2`)?.listId === f.listAId && !titled(s, `N ${f.id}`),
};

// --- one case ----------------------------------------------------------------------------------

type Session = { tabs: Tab[]; contexts: BrowserContext[]; events: string[] };

async function openTabs(browser: Browser, tabs: Tabs): Promise<Session> {
  const events: string[] = [];
  const contexts: BrowserContext[] = [await openUser(browser, OWNER)];
  const a = await openTasksTab(contexts[0]!, "A", events);
  const all = [a];
  if (tabs === "same") all.push(await openTasksTab(contexts[0]!, "A2", events));
  if (tabs === "device") {
    contexts.push(await openUser(browser, OWNER));
    all.push(await openTasksTab(contexts[1]!, "B", events));
  }
  return { tabs: all, contexts, events };
}

async function closeTabs(session: Session | null) {
  if (!session) return;
  // Offline, a "Failed to fetch" is expected: report page errors, do not fail on them.
  for (const event of session.events) {
    test.info().annotations.push({ type: "page error", description: event });
  }
  for (const context of session.contexts) await context.close().catch(() => undefined);
}

/** Every tab holds the case before the action, with what the tabs logged if not. */
async function expectLoaded(session: Session, id: string) {
  const open = await converge(session.tabs, id, 30_000);
  const log = session.events.slice(-12).join("\n");
  expect(open, `every tab loads the case first${log ? `\n${log}` : ""}`).toEqual({});
}

async function hardRefresh(tabs: Tab[]) {
  for (const tab of tabs) {
    await tab.reload();
    await waitForTasks(tab);
  }
  await sleep(2_000);
}

async function runCase(browser: Browser, action: Action, tabs: Tabs, net: Net, id: string) {
  let session: Session | null = null;
  try {
    const f = await seed(id, SEEDS_TASK.includes(action));
    session = await openTabs(browser, tabs);
    const all = session.tabs;
    const [a, b] = all;
    await expectLoaded(session, id);

    const offline = { on: [], off: [a!], both: all, aOff: [a!], bOff: b ? [b] : [] }[net];
    for (const tab of offline) await setTabOffline(tab, true);
    await sleep(1_000);
    await a!.bringToFront();
    await ACTIONS[action](a!, f);
    await sleep(1_000);
    for (const tab of offline) await setTabOffline(tab, false);

    await expect
      .poll(async () => LANDED[action](await serverState(id), f), {
        message: "the server holds the action",
        timeout: 30_000,
        intervals: [2_500],
      })
      .toBe(true)
      .catch(async (error: unknown) => {
        for (const tab of all) {
          const queued = (await tabCache(tab, id).catch(() => null))?.outbox ?? [];
          if (queued.length) error = new Error(`${String(error)}\n${tab.tag} outbox: ${queued}`);
        }
        throw error;
      });
    expect(await converge(all, id, MIRROR_MS), "every tab mirrors the server").toEqual({});

    await hardRefresh(all);
    expect(await converge(all, id, 15_000), "still in sync after a hard refresh").toEqual({});
  } finally {
    await closeTabs(session);
    await cleanUpCase(id);
  }
}

// --- inbound helpers ---------------------------------------------------------------------------

/** Fail the matching requests at the network, so the app queues the write. */
async function holdRequests(tab: Tab, method: string, path: string): Promise<() => Promise<void>> {
  const url = `**/api/v1${path}`;
  const handler = async (route: Route) => {
    // The app tunnels PATCH, PUT and DELETE through POST (`X-HTTP-Method-Override`).
    const request = route.request();
    const sent = (await request.headerValue("x-http-method-override")) ?? request.method();
    if (sent === method) await route.abort("internetdisconnected");
    else await route.fallback();
  };
  await tab.route(url, handler);
  return () => tab.unroute(url, handler);
}

/** A short drop of the connection: the reconnect flushes the queue, then pulls. */
async function reconnect(tab: Tab) {
  await setTabOffline(tab, true);
  await sleep(1_500);
  await setTabOffline(tab, false);
}

/** `GET tasks/tasklists/changes` calls since now, split into token pulls and full lists. */
function watchChanges(tabs: Tab[]) {
  const calls = { since: 0, full: 0, relisted: new Set<string>() };
  for (const tab of tabs) {
    tab.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname.endsWith("/tasks/tasklists/changes")) {
        if (url.searchParams.has("since")) calls.since += 1;
        else calls.full += 1;
      }
      if (url.pathname.endsWith("/tasks/items") && url.searchParams.has("taskListId")) {
        calls.relisted.add(url.searchParams.get("taskListId")!);
      }
    });
  }
  return calls;
}

function pollCache<T>(
  tab: Tab,
  id: string,
  read: (c: Awaited<ReturnType<typeof tabCache>>) => T,
  message: string,
) {
  return expect.poll(async () => read(await tabCache(tab, id)), {
    message,
    timeout: 2 * POLL_MS + 10_000,
    intervals: [2_000],
  });
}

async function expectNoConflict(tab: Tab) {
  await sleep(2_000);
  await expect(conflictDialog(tab), "no sync conflict").toHaveCount(0);
}

/** Inject a queued edit with no recorded base, as one written before bases were kept. */
async function queueEditWithoutBase(tab: Tab, taskId: string, title: string) {
  await tab.evaluate(
    async ({ taskId, title }) => {
      const user = localStorage.getItem("wgw.offline.tasks.username") ?? "";
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(`wgw-offline-${user.trim().toLowerCase()}`);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(["outbox", "tasks_items"], "readwrite");
        tx.objectStore("outbox").put({
          id: crypto.randomUUID(),
          domain: "tasks",
          op: "update",
          payload: JSON.stringify({ taskId, patch: { title } }),
          createdAt: Date.now(),
          retries: 0,
        });
        const items = tx.objectStore("tasks_items");
        const get = items.get(taskId);
        get.onsuccess = () => {
          const row = get.result as { data: string; pendingSync: boolean };
          const task = JSON.parse(row.data) as Record<string, unknown>;
          items.put({ ...row, data: JSON.stringify({ ...task, title }), pendingSync: true });
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    },
    { taskId, title },
  );
}

/** One tab on a fresh case: list A with tasks "T1..Tn <id>", list B with the bystander. */
async function inboundCase(browser: Browser, id: string, taskCount: number) {
  const f = await seed(id, false);
  const tasks: string[] = [];
  for (let i = 1; i <= taskCount; i += 1) {
    tasks.push((await createTask(f.listAId, `T${i} ${id}`)).id);
  }
  const session = await openTabs(browser, "one");
  const tab = session.tabs[0]!;
  await expectLoaded(session, id);
  return { f, tasks, session, tab };
}

// --- known bugs --------------------------------------------------------------------------------

/**
 * Open bugs this matrix found, by case. Such a case is marked as expected to
 * fail, so the run stays green and a fix shows up as "expected to fail, but
 * passed": then drop the entry.
 */
const BUGS = {
  listDeleteOffline: 1812, // an offline list delete drops the cached tasks of other lists
  moveIgnored: 1813, // the server does not move a task to another list
  renameMoveConflict: 1814, // an offline rename + move conflicts with itself
  sameBrowserTabStale: 1815, // a second tab of one browser keeps an old view
  createRenameLost: 1816, // an edit to a task created offline goes to its temporary id
};

function knownBugs(action: Action, tabs: Tabs, net: Net): number[] {
  const bugs: number[] = [];
  if (action === "move" || action === "renameMove") bugs.push(BUGS.moveIgnored);
  if (action === "renameMove") bugs.push(BUGS.renameMoveConflict);
  if (action === "createRename") bugs.push(BUGS.createRenameLost);
  if (action === "listDelete" && ["off", "both", "aOff"].includes(net)) {
    bugs.push(BUGS.listDeleteOffline);
  }
  // The other tab stays online while tab A changes the shared cache.
  if (tabs === "same" && ["on", "aOff"].includes(net) && bugs.length === 0) {
    bugs.push(BUGS.sameBrowserTabStale);
  }
  if (tabs === "same" && net === "aOff" && action === "listDelete") {
    bugs.push(BUGS.sameBrowserTabStale);
  }
  return bugs;
}

function expectKnownBugs(bugs: number[]) {
  if (bugs.length === 0) return;
  const issues = bugs.map((bug) => `#${bug}`).join(", ");
  for (const bug of bugs) test.info().annotations.push({ type: "issue", description: `#${bug}` });
  test.fail(true, `known bug ${issues}`);
}

// --- the matrix --------------------------------------------------------------------------------

test.use({ storageState: { cookies: [], origins: [] }, actionTimeout: 15_000 });

test.beforeAll(async ({ browser }) => {
  // A cold Vite dev server compiles each module on first request and may reload
  // the page; pay for that once, before the first case.
  const context = await openUser(browser, OWNER);
  try {
    const tab = await openTasksTab(context, "warm-up", []);
    await tab.getByRole("button", { name: "More create options" }).click();
    await tab.keyboard.press("Escape");
    await tab.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
  } finally {
    await context.close().catch(() => undefined);
  }
});

for (const action of Object.keys(ACTIONS) as Action[]) {
  const nets = COMPOUND.includes(action) ? COMPOUND_NETS : NETS;
  for (const tabs of Object.keys(nets) as Tabs[]) {
    for (const net of nets[tabs]) {
      test(`${action} · ${tabs} · ${net}`, async ({ browser }) => {
        expectKnownBugs(knownBugs(action, tabs, net));
        await runCase(browser, action, tabs, net, caseId());
      });
    }
  }
}

test.describe("inbound", () => {
  // Changes elsewhere reach every tab through the changes token, online and
  // after a reconnect, without a full re-list.
  for (const tabs of Object.keys(NETS) as Tabs[]) {
    for (const net of ["on", "both"] as const) {
      test(`elsewhere · token · ${tabs} · ${net}`, async ({ browser }) => {
        if (tabs === "same" && net === "on") expectKnownBugs([BUGS.sameBrowserTabStale]);
        const id = caseId();
        let session: Session | null = null;
        try {
          const f = await seed(id, false);
          const [t1, t2, t3] = [
            await createTask(f.listAId, `T1 ${id}`),
            await createTask(f.listAId, `T2 ${id}`),
            await createTask(f.listAId, `T3 ${id}`),
          ];
          session = await openTabs(browser, tabs);
          const all = session.tabs;
          await expectLoaded(session, id);
          const before = await Promise.all(all.map(async (tab) => (await tabCache(tab, id)).token));
          const calls = watchChanges(all);

          if (net === "both") for (const tab of all) await setTabOffline(tab, true);
          await patchTask(t1!.id, { title: `T1 ${id} v2` });
          await patchTask(t2!.id, { workflowStatus: "completed" });
          await deleteTask(t3!.id);
          await createTask(f.listAId, `T4 ${id}`);
          if (net === "both") {
            await sleep(2_000);
            for (const tab of all) await setTabOffline(tab, false);
          }

          expect(await converge(all, id, MIRROR_MS), "every tab mirrors the server").toEqual({});
          for (const [i, tab] of all.entries()) {
            expect((await tabCache(tab, id)).token, `${tab.tag} moved its token`).not.toBe(
              before[i],
            );
          }
          expect(calls.since, "pulled through the token").toBeGreaterThan(0);
          expect(calls.full, "no full re-list").toBe(0);
        } finally {
          await closeTabs(session);
          await cleanUpCase(id);
        }
      });
    }
  }

  test("elsewhere · full list on an unknown token · keeps a queued create", async ({ browser }) => {
    const id = caseId();
    let session: Session | null = null;
    try {
      const c = await inboundCase(browser, id, 2);
      session = c.session;
      const listCId = await createList(`M ${id} c`);
      await createTask(listCId, `T5 ${id}`);
      expect(await converge([c.tab], id, MIRROR_MS), "the tab loads list C").toEqual({});

      const release = await holdRequests(c.tab, "POST", "/tasks/items");
      await ACTIONS.create(c.tab, c.f);
      await setStoredToken(c.tab, "expired-token");
      const calls = watchChanges([c.tab]);
      await deleteTask(c.tasks[0]!);
      await patchTask(c.tasks[1]!, { title: `T2 ${id} v2` });
      await deleteList(listCId);

      await pollCache(
        c.tab,
        id,
        (cache) => cache.tasks.some((t) => t.title === `T2 ${id} v2`),
        "the full list lands",
      ).toBe(true);
      expect(calls.full, "the unknown token fell back to a full list").toBeGreaterThan(0);
      const cache = await tabCache(c.tab, id);
      expect(cache.token, "a fresh token").not.toBe("expired-token");
      expect(cache.tasks.map((t) => t.title).sort()).toEqual(
        [`B ${id}`, `N ${id}`, `T2 ${id} v2`].sort(),
      );
      expect(cache.tasks.find((t) => t.title === `N ${id}`)?.pending, "queued create kept").toBe(
        true,
      );
      expect(cache.lists.map((l) => l.name).sort(), "list C is gone").toEqual(
        [c.f.listA, c.f.listB].sort(),
      );

      await release();
      await reconnect(c.tab);
      expect(await converge([c.tab], id, MIRROR_MS), "the queued create lands").toEqual({});
      expect((await serverState(id)).tasks.some((t) => t.title === `N ${id}`)).toBe(true);
    } finally {
      await closeTabs(session);
      await cleanUpCase(id);
    }
  });

  test("elsewhere · full list with no stored token", async ({ browser }) => {
    const id = caseId();
    let session: Session | null = null;
    try {
      const c = await inboundCase(browser, id, 2);
      session = c.session;
      await setStoredToken(c.tab, null);
      const calls = watchChanges([c.tab]);
      await patchTask(c.tasks[0]!, { title: `T1 ${id} v2` });
      await deleteTask(c.tasks[1]!);
      expect(await converge([c.tab], id, MIRROR_MS), "the tab mirrors the server").toEqual({});
      expect(calls.full, "no token: a full list").toBeGreaterThan(0);
      expect((await tabCache(c.tab, id)).token, "a token again").not.toBeNull();
    } finally {
      await closeTabs(session);
      await cleanUpCase(id);
    }
  });

  test("elsewhere · token re-list drops a deleted task, keeps a queued create", async ({
    browser,
  }) => {
    const id = caseId();
    let session: Session | null = null;
    try {
      const c = await inboundCase(browser, id, 1);
      session = c.session;
      const release = await holdRequests(c.tab, "POST", "/tasks/items");
      await ACTIONS.create(c.tab, c.f);
      const calls = watchChanges([c.tab]);
      await deleteTask(c.tasks[0]!);

      await pollCache(
        c.tab,
        id,
        (cache) => cache.tasks.some((t) => t.title === `T1 ${id}`),
        "the deleted task leaves the cache",
      ).toBe(false);
      const cache = await tabCache(c.tab, id);
      expect(cache.tasks.find((t) => t.title === `N ${id}`)?.pending, "queued create kept").toBe(
        true,
      );
      expect(calls.full, "through the token").toBe(0);

      await release();
      await reconnect(c.tab);
      expect(await converge([c.tab], id, MIRROR_MS), "the queued create lands").toEqual({});
    } finally {
      await closeTabs(session);
      await cleanUpCase(id);
    }
  });

  test("conflict · a queued edit and an edit elsewhere since", async ({ browser }) => {
    const id = caseId();
    let session: Session | null = null;
    try {
      const c = await inboundCase(browser, id, 1);
      session = c.session;
      const release = await holdRequests(c.tab, "PATCH", `/tasks/items/${c.tasks[0]}`);
      await editTask(c.tab, `T1 ${id}`, { title: `T1 ${id} mine` });
      expect((await tabCache(c.tab, id)).outbox, "the edit is queued").toEqual(["update"]);
      await patchTask(c.tasks[0]!, { title: `T1 ${id} theirs` });

      await expect(conflictDialog(c.tab), "the moved server reports a conflict").toBeVisible({
        timeout: 2 * POLL_MS + 10_000,
      });
      const cache = await tabCache(c.tab, id);
      expect(cache.tasks.find((t) => t.id === c.tasks[0])?.title, "local edit kept").toBe(
        `T1 ${id} mine`,
      );

      await release();
      const keep = conflictDialog(c.tab).getByRole("button", { name: /Keep mine|Apply merged/ });
      await keep.first().click();
      await expect(conflictDialog(c.tab)).toHaveCount(0, { timeout: 15_000 });
      await expect
        .poll(async () => (await serverState(id)).tasks.find((t) => t.id === c.tasks[0])?.title, {
          message: "keep mine lands on the server",
          timeout: 30_000,
        })
        .toBe(`T1 ${id} mine`);
      expect(await converge([c.tab], id, MIRROR_MS), "the tab mirrors the server").toEqual({});
    } finally {
      await closeTabs(session);
      await cleanUpCase(id);
    }
  });

  test("no conflict · a queued edit whose task did not move elsewhere", async ({ browser }) => {
    const id = caseId();
    let session: Session | null = null;
    try {
      const c = await inboundCase(browser, id, 2);
      session = c.session;
      const release = await holdRequests(c.tab, "PATCH", `/tasks/items/${c.tasks[0]}`);
      await editTask(c.tab, `T1 ${id}`, { title: `T1 ${id} mine` });
      // Another task on the same list changes, so the list is re-listed.
      await patchTask(c.tasks[1]!, { title: `T2 ${id} v2` });

      await pollCache(
        c.tab,
        id,
        (cache) => cache.tasks.some((t) => t.title === `T2 ${id} v2`),
        "the list is re-listed",
      ).toBe(true);
      await expectNoConflict(c.tab);
      const cache = await tabCache(c.tab, id);
      const mine = cache.tasks.find((t) => t.id === c.tasks[0]);
      expect([mine?.title, mine?.pending], "local edit kept and still queued").toEqual([
        `T1 ${id} mine`,
        true,
      ]);

      await release();
      await reconnect(c.tab);
      expect(await converge([c.tab], id, MIRROR_MS), "the queued edit lands").toEqual({});
      expect((await serverState(id)).tasks.some((t) => t.title === `T1 ${id} mine`)).toBe(true);
    } finally {
      await closeTabs(session);
      await cleanUpCase(id);
    }
  });

  test("no conflict · a queued edit with no recorded base", async ({ browser }) => {
    const id = caseId();
    let session: Session | null = null;
    try {
      const c = await inboundCase(browser, id, 1);
      session = c.session;
      await queueEditWithoutBase(c.tab, c.tasks[0]!, `T1 ${id} mine`);
      const before = (await tabCache(c.tab, id)).token;
      await patchTask(c.tasks[0]!, { title: `T1 ${id} theirs` });

      await pollCache(c.tab, id, (cache) => cache.token !== before, "the change is pulled").toBe(
        true,
      );
      await expectNoConflict(c.tab);
      const mine = (await tabCache(c.tab, id)).tasks.find((t) => t.id === c.tasks[0]);
      expect([mine?.title, mine?.pending], "an unknown base is not moved").toEqual([
        `T1 ${id} mine`,
        true,
      ]);

      // Sending it is not the inbound contract: the API refuses a write
      // without If-Match, so the flush reports that one as a conflict.
    } finally {
      await closeTabs(session);
      await cleanUpCase(id);
    }
  });

  test("list delete · elsewhere, while one of its tasks has a queued edit", async ({ browser }) => {
    const id = caseId();
    let session: Session | null = null;
    try {
      const c = await inboundCase(browser, id, 2);
      session = c.session;
      const release = await holdRequests(c.tab, "PATCH", `/tasks/items/${c.tasks[0]}`);
      await editTask(c.tab, `T1 ${id}`, { title: `T1 ${id} mine` });
      await deleteList(c.f.listAId);

      await pollCache(
        c.tab,
        id,
        (cache) => cache.lists.some((l) => l.id === c.f.listAId),
        "the list leaves the cache",
      ).toBe(false);
      const cache = await tabCache(c.tab, id);
      expect(
        cache.tasks.map((t) => t.title).sort(),
        "its other task goes, the queued one stays",
      ).toEqual([`B ${id}`, `T1 ${id} mine`].sort());
      await expect(conflictDialog(c.tab), "the queued edit is a conflict").toBeVisible({
        timeout: 10_000,
      });
      await release();
    } finally {
      await closeTabs(session);
      await cleanUpCase(id);
    }
  });

  test("list delete · queued here, changes elsewhere do not bring it back", async ({ browser }) => {
    expectKnownBugs([BUGS.listDeleteOffline]);
    const id = caseId();
    let session: Session | null = null;
    try {
      const c = await inboundCase(browser, id, 1);
      session = c.session;
      const release = await holdRequests(c.tab, "DELETE", `/tasks/tasklists/${c.f.listAId}`);
      await ACTIONS.listDelete(c.tab, c.f);
      expect((await tabCache(c.tab, id)).outbox, "the delete is queued").toEqual(["listDelete"]);
      const calls = watchChanges([c.tab]);
      await createTask(c.f.listAId, `T9 ${id}`);
      await patchTask(c.tasks[0]!, { title: `T1 ${id} v2` });

      await expect
        .poll(() => calls.relisted.has(c.f.listAId), {
          message: "a pull re-lists the list",
          timeout: 2 * POLL_MS + 10_000,
        })
        .toBe(true);
      await sleep(1_500);
      const cache = await tabCache(c.tab, id);
      expect(
        cache.lists.map((l) => l.name),
        "the list stays gone",
      ).toEqual([c.f.listB]);
      expect(
        cache.tasks.map((t) => t.title),
        "its tasks stay gone",
      ).toEqual([`B ${id}`]);

      await release();
      await reconnect(c.tab);
      await expect
        .poll(async () => (await serverState(id)).lists.some((l) => l.id === c.f.listAId), {
          message: "the queued delete lands",
          timeout: 30_000,
        })
        .toBe(false);
      expect(await converge([c.tab], id, MIRROR_MS), "the tab mirrors the server").toEqual({});
    } finally {
      await closeTabs(session);
      await cleanUpCase(id);
    }
  });
});
