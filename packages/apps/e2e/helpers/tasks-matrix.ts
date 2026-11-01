// Helpers for the Tasks sync matrix (`tasks-sync-matrix.spec.ts`): the server
// state of one case as each user sees it, each tab's offline cache and view,
// and "does every tab match the server". Every list and task of a case carries
// the case id in its name, so a case only ever looks at its own rows.
//
// A list shared with the teammate has another id for them than for the owner;
// a task keeps its id. So every comparison is per user: a tab against the
// server as its own user sees it.
import { test, type BrowserContext } from "@playwright/test";
import { api, OWNER, sleep, TEAMMATE, type Tab } from "./live-matrix";

export { api, openUser, OWNER, setTabOffline, sleep, TEAMMATE, type Tab } from "./live-matrix";

/** One inbound poll (10 s) plus the time to re-list and paint. */
export const POLL_MS = 10_000;

/**
 * The group for the "share with a group" case. The share search offers only
 * groups the owner is in, so it holds both users, as a real team does.
 */
export const TASKS_TEAM = { slug: "e2e-tasks-team", name: "E2E Tasks Team" };

// --- task and list fields -----------------------------------------------------------------------

/**
 * The fields a case compares, in one shape for the server and the cache. The
 * server rewrites some values (a date-only due loses its time, reminder ids
 * are renumbered, priority 0 becomes null), so both sides go through `fields`.
 */
export type TaskFields = {
  title: string;
  listId: string;
  description: string;
  priority: number;
  /** `2026-11-09` (all day) or `2026-11-09T09:00 Europe/Amsterdam`; empty when none. */
  due: string;
  /** Reminder offsets, sorted: `-PT15M end`. */
  alerts: string[];
  status: string;
  completed: boolean;
};

export type RawTask = {
  id: string;
  title?: string | null;
  taskListId: string;
  description?: string | null;
  priority?: number | null;
  due?: string | null;
  showWithoutTime?: boolean | null;
  timeZone?: string | null;
  alerts?: Record<
    string,
    { trigger?: { "@type"?: string; offset?: string; relativeTo?: string; when?: string } }
  > | null;
  workflowStatus?: string | null;
  etag?: string;
};

export function fields(task: RawTask): TaskFields {
  const rawDue = task.due ?? "";
  const allDay = task.showWithoutTime === true || /^\d{4}-\d{2}-\d{2}$/.test(rawDue);
  const due = !rawDue
    ? ""
    : allDay
      ? rawDue.slice(0, 10)
      : `${rawDue.slice(0, 16)} ${task.timeZone ?? "floating"}`;
  const alerts = Object.values(task.alerts ?? {})
    .map(({ trigger }) =>
      trigger?.["@type"] === "AbsoluteTrigger"
        ? `at ${trigger.when}`
        : `${trigger?.offset} ${trigger?.relativeTo ?? "end"}`,
    )
    .sort();
  const status = task.workflowStatus || "needs-action";
  return {
    title: task.title ?? "",
    listId: task.taskListId,
    description: task.description ?? "",
    priority: task.priority ?? 0,
    due,
    alerts,
    status,
    completed: status === "completed",
  };
}

const FIELD_KEYS = [
  "title",
  "listId",
  "description",
  "priority",
  "due",
  "alerts",
  "status",
] as const satisfies readonly (keyof TaskFields)[];

// --- server -------------------------------------------------------------------------------------

export type ServerTask = TaskFields & { id: string; etag: string };
export type ServerList = {
  id: string;
  name: string;
  color: string;
  /** The owner's grants: `member write`, `groups/x read`. Empty for a sharee. */
  shares: string[];
  writable: boolean;
};
export type ServerState = { lists: ServerList[]; tasks: ServerTask[] };

type RawList = {
  id: string;
  name: string;
  color?: string | null;
  shareWith?: Record<string, { mayWrite?: boolean } | null> | null;
  myRights?: { mayWriteAll?: boolean } | null;
};

function toServerTask(task: RawTask): ServerTask {
  return { ...fields(task), id: task.id, etag: task.etag ?? "" };
}

function toServerList(list: RawList): ServerList {
  const shares = Object.entries(list.shareWith ?? {})
    .filter(([, rights]) => rights)
    .map(([who, rights]) => `${who} ${rights?.mayWrite ? "write" : "read"}`)
    .sort();
  return {
    id: list.id,
    name: list.name,
    color: (list.color ?? "").toLowerCase(),
    shares,
    writable: list.myRights?.mayWriteAll !== false,
  };
}

function ok(res: { status: number; json: unknown }, what: string, codes = [200, 201, 204]) {
  if (!codes.includes(res.status)) {
    throw new Error(`${what}: ${res.status} ${JSON.stringify(res.json).slice(0, 200)}`);
  }
}

export async function createList(name: string, extra: Record<string, unknown> = {}) {
  const res = await api(OWNER, "POST", "/tasks/tasklists", { name, ...extra });
  ok(res, `create list ${name}`);
  return (res.json as { id: string }).id;
}

/** Delete a list and the tasks on it, as the app does. A missing list is fine. */
export async function deleteList(listId: string): Promise<void> {
  const res = await api(OWNER, "DELETE", `/tasks/tasklists/${encodeURIComponent(listId)}`, {
    onDestroyRemoveContents: true,
  });
  ok(res, `delete list ${listId}`, [200, 204, 404]);
}

export type Rights = "read" | "write";

/** Grant (or with null, revoke) access to an owner's list. */
export async function shareList(listId: string, who: string, rights: Rights | null) {
  const grant = rights && { mayRead: true, mayWriteAll: rights === "write" };
  const res = await api(OWNER, "PATCH", `/tasks/tasklists/${encodeURIComponent(listId)}`, {
    shareWith: { [who]: grant },
  });
  ok(res, `share ${listId} with ${who}`);
}

/** The group for the "share with a group" case, with both users (idempotent). */
export async function ensureTasksTeam(): Promise<void> {
  await api(OWNER, "POST", "/admin/groups", {
    slug: TASKS_TEAM.slug,
    displayName: TASKS_TEAM.name,
  });
  for (const user of [OWNER, TEAMMATE]) {
    await api(OWNER, "PUT", `/admin/groups/${TASKS_TEAM.slug}/members/${user}`);
  }
}

export async function createTask(
  listId: string,
  title: string,
  extra: Record<string, unknown> = {},
  user = OWNER,
): Promise<ServerTask> {
  const res = await api(user, "POST", "/tasks/items", {
    taskListIds: { [listId]: true },
    title,
    ...extra,
  });
  ok(res, `create task ${title}`);
  return toServerTask(res.json as RawTask);
}

export async function serverTask(taskId: string, user = OWNER): Promise<ServerTask | null> {
  const res = await api(user, "GET", `/tasks/items/${encodeURIComponent(taskId)}`);
  if (res.status === 404) return null;
  ok(res, `get task ${taskId}`);
  return toServerTask(res.json as RawTask);
}

/** Change a task the way another client does: against its current etag. */
export async function patchTask(
  taskId: string,
  patch: Record<string, unknown>,
  user = OWNER,
): Promise<{ status: number; json: unknown }> {
  const current = await serverTask(taskId, user);
  if (!current) throw new Error(`patch task ${taskId}: gone`);
  return api(user, "PATCH", `/tasks/items/${encodeURIComponent(taskId)}`, patch, {
    "If-Match": current.etag,
  });
}

export async function deleteTask(taskId: string): Promise<void> {
  const current = await serverTask(taskId);
  if (!current) return;
  const res = await api(OWNER, "DELETE", `/tasks/items/${encodeURIComponent(taskId)}`, undefined, {
    "If-Match": current.etag,
  });
  ok(res, `delete task ${taskId}`, [200, 204, 404]);
}

/**
 * The lists and tasks whose name carries `caseId`, as `user` sees them. A case
 * only puts tasks on its own lists, so only those are listed: the API allows
 * one user 600 requests a minute, shared with every open tab.
 */
export async function serverState(caseId: string, user = OWNER): Promise<ServerState> {
  const res = await api(user, "GET", "/tasks/tasklists");
  ok(res, "list task lists");
  const lists = ((res.json as { list?: RawList[] }).list ?? [])
    .filter((list) => list.name.includes(caseId))
    .map(toServerList);
  const tasks: ServerTask[] = [];
  for (const list of lists) {
    const items = await api(user, "GET", `/tasks/items?taskListId=${encodeURIComponent(list.id)}`);
    if (items.status === 404) continue;
    ok(items, `list tasks of ${list.id}`);
    for (const task of (items.json as { list?: RawTask[] }).list ?? []) {
      if ((task.title ?? "").includes(caseId)) tasks.push(toServerTask(task));
    }
  }
  return { lists, tasks };
}

/**
 * Mark a user's unread notifications read. Every share sends the teammate a
 * notification, and every page load acks each unread one with a request of
 * its own (#1826): left alone they pile up until a load hits the rate limit.
 */
export async function readAllNotifications(user: string): Promise<void> {
  // The inbox lists at most 100 at a time.
  for (let page = 0; page < 20; page += 1) {
    const res = await api(user, "GET", "/notifications?unread=1");
    const list = (res.json as { list?: Array<{ id: string }> } | null)?.list ?? [];
    if (list.length === 0) return;
    for (const item of list) {
      await api(user, "POST", `/notifications/${encodeURIComponent(item.id)}/ack`);
    }
  }
}

/** Remove every list of a case, with its tasks, and the notifications it caused. */
export async function cleanUpCase(caseId: string): Promise<void> {
  const state = await serverState(caseId).catch(() => null);
  for (const list of state?.lists ?? []) await deleteList(list.id);
  for (const user of [OWNER, TEAMMATE]) await readAllNotifications(user).catch(() => undefined);
}

// --- tabs ---------------------------------------------------------------------------------------

/** A Tasks tab that records page errors, console errors and failed requests into `events`. */
export async function openTasksTab(
  context: BrowserContext,
  tag: string,
  events: string[],
  user = OWNER,
): Promise<Tab> {
  const page = (await context.newPage()) as Tab;
  page.tag = tag;
  page.user = user;
  page.on("pageerror", (error) => events.push(`${tag} page error: ${String(error).slice(0, 160)}`));
  page.on("response", (response) => {
    if (response.status() < 400 || !response.url().includes("/api/")) return;
    const url = response.url().replace(/^https?:\/\/[^/]+/, "");
    events.push(`${tag} ${response.status()}: ${response.request().method()} ${url.slice(0, 120)}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error") events.push(`${tag} console: ${message.text().slice(0, 160)}`);
  });
  page.on("requestfailed", (request) => {
    const url = request.url().replace(/^https?:\/\/[^/]+/, "");
    // Presence long-polls are cut off on every reload and close: not a finding.
    if (url.includes("/rooms/")) return;
    events.push(`${tag} request failed: ${request.method()} ${url.slice(0, 120)}`);
  });
  await page.goto("/tasks");
  await waitForTasks(page);
  return page;
}

/** The list is painted: the composer is there and the first load is done. */
export async function waitForTasks(tab: Tab): Promise<void> {
  await tab.getByRole("textbox", { name: "Task name" }).waitFor({ timeout: 60_000 });
  await tab.getByRole("button", { name: "All Tasks" }).waitFor({ timeout: 60_000 });
}

export type CachedTask = TaskFields & { id: string; pending: boolean };
export type TabCache = {
  missingDb?: boolean;
  lists: Array<{ id: string; name: string; color: string }>;
  tasks: CachedTask[];
  /** Every queued Tasks write, as `op` or `op (status error)` after a failed send. */
  outbox: string[];
  token: string | null;
};

/** The tab's Tasks cache, limited to rows that carry `caseId`. */
export async function tabCache(tab: Tab, caseId: string): Promise<TabCache> {
  const raw = await tab.evaluate(async (id) => {
    const user = localStorage.getItem("wgw.offline.tasks.username");
    const empty = { missingDb: true, lists: [], tasks: [], outbox: [], token: null };
    if (!user) return empty;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(`wgw-offline-${user.trim().toLowerCase()}`);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const stores = [...db.objectStoreNames];
    if (!stores.includes("tasks_items")) {
      db.close();
      return empty;
    }
    const all = <T>(store: string) =>
      new Promise<T[]>((resolve) => {
        const request = db.transaction(store).objectStore(store).getAll();
        request.onsuccess = () => resolve(request.result as T[]);
        request.onerror = () => resolve([]);
      });
    const lists = (await all<{ id: string; data: string }>("tasks_task_lists")).map((row) => {
      const list = JSON.parse(row.data) as { name?: string; color?: string | null };
      return { id: row.id, name: list.name ?? "", color: (list.color ?? "").toLowerCase() };
    });
    const tasks = (await all<{ id: string; data: string; pendingSync: boolean }>("tasks_items"))
      .map((row) => ({ id: row.id, data: row.data, pending: row.pendingSync }))
      .filter((row) => String((JSON.parse(row.data) as { title?: string }).title).includes(id));
    const outbox = (
      await all<{ domain: string; op: string; lastError?: string; lastStatus?: number }>("outbox")
    )
      .filter((row) => row.domain === "tasks")
      .map((row) => {
        if (!row.lastError) return row.op;
        return `${row.op} (${row.lastStatus ?? "-"} ${row.lastError.slice(0, 80)})`;
      });
    const meta = await all<{ key: string; value: string }>("meta");
    db.close();
    return {
      lists: lists.filter((list) => list.name.includes(id)),
      tasks,
      outbox,
      token: meta.find((row) => row.key === "tasks:changes-state")?.value ?? null,
    };
  }, caseId);
  return {
    ...raw,
    tasks: raw.tasks.map((row) => ({
      ...fields({ ...(JSON.parse(row.data) as RawTask), id: row.id }),
      id: row.id,
      pending: row.pending,
    })),
  };
}

/** Overwrite (or with null, drop) the stored changes token, as an expired one would be. */
export async function setStoredToken(tab: Tab, token: string | null): Promise<void> {
  await tab.evaluate(async (value) => {
    const user = localStorage.getItem("wgw.offline.tasks.username") ?? "";
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(`wgw-offline-${user.trim().toLowerCase()}`);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("meta", "readwrite");
      const store = tx.objectStore("meta");
      if (value === null) store.delete("tasks:changes-state");
      else store.put({ key: "tasks:changes-state", value });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, token);
}

/** Titles the tab's "All Tasks" view shows (completed tasks are hidden there). */
export async function shownTitles(tab: Tab, caseId: string): Promise<string[]> {
  const titles = await tab
    .locator(".tasks-main-view__title")
    .evaluateAll((els) => els.map((el) => (el.textContent ?? "").trim()));
  return titles.filter((title) => title.includes(caseId)).sort();
}

/** The sidebar sections that hold lists: the user's own and those shared with them. */
export const LIST_SECTIONS = ["My lists", "Shared with me"] as const;

/** List names the tab's sidebar shows, in either section. */
export async function shownLists(tab: Tab, caseId: string): Promise<string[]> {
  const names: string[] = [];
  for (const section of LIST_SECTIONS) {
    const region = tab.getByRole("region", { name: section });
    if ((await region.count()) === 0) continue;
    names.push(
      ...(await region
        .getByRole("listitem")
        .evaluateAll((els) =>
          els.map((el) => el.querySelector("button:not([aria-label])")?.textContent?.trim() ?? ""),
        )),
    );
  }
  return names.filter((name) => name.includes(caseId)).sort();
}

export async function showAllTasks(tab: Tab): Promise<void> {
  await tab.getByRole("button", { name: "All Tasks" }).click();
  await sleep(300);
}

// --- convergence --------------------------------------------------------------------------------

const sameSet = (a: string[], b: string[]) => a.join("\n") === b.join("\n");
const show = (value: unknown) => JSON.stringify(value);

/** What a tab's cache and view show that differs from the server. Empty means in sync. */
export async function tabDiff(tab: Tab, want: ServerState, caseId: string): Promise<string[]> {
  const have = await tabCache(tab, caseId);
  if (have.missingDb) return ["no offline cache"];
  const diffs: string[] = [];
  if (have.outbox.length) diffs.push(`outbox: ${have.outbox.join(", ")}`);

  for (const list of want.lists) {
    const row = have.lists.find((entry) => entry.id === list.id);
    if (!row) diffs.push(`cache lacks list "${list.name}"`);
    else {
      if (row.name !== list.name) diffs.push(`list "${row.name}" ≠ "${list.name}"`);
      if (row.color !== list.color)
        diffs.push(`list "${list.name}" color ${row.color} ≠ ${list.color}`);
    }
  }
  for (const row of have.lists) {
    if (!want.lists.some((list) => list.id === row.id)) {
      diffs.push(`cache keeps list "${row.name}" the server does not have`);
    }
  }
  for (const task of want.tasks) {
    const row = have.tasks.find((entry) => entry.id === task.id);
    if (!row) {
      diffs.push(`cache lacks task "${task.title}"`);
      continue;
    }
    if (row.pending) diffs.push(`"${task.title}" still pending`);
    for (const key of FIELD_KEYS) {
      if (show(row[key]) !== show(task[key])) {
        diffs.push(`"${task.title}" ${key} ${show(row[key])} ≠ ${show(task[key])}`);
      }
    }
  }
  for (const row of have.tasks) {
    if (!want.tasks.some((task) => task.id === row.id)) {
      diffs.push(`cache keeps task "${row.title}" (${row.id}) the server does not have`);
    }
  }

  // What the person sees: the "All Tasks" view and the sidebar.
  const titles = await shownTitles(tab, caseId);
  const wantTitles = want.tasks
    .filter((task) => !task.completed)
    .map((task) => task.title)
    .sort();
  if (!sameSet(titles, wantTitles)) diffs.push(`view [${titles}] ≠ [${wantTitles}]`);
  const lists = await shownLists(tab, caseId);
  const wantLists = want.lists.map((list) => list.name).sort();
  if (!sameSet(lists, wantLists)) diffs.push(`sidebar [${lists}] ≠ [${wantLists}]`);
  return diffs;
}

/** The server state of a case for every user that has a tab open. */
export async function serverStates(tabs: Tab[], caseId: string) {
  const states = new Map<string, ServerState>();
  for (const user of new Set(tabs.map((tab) => tab.user))) {
    states.set(user, await serverState(caseId, user));
  }
  return states;
}

/** Poll until every tab mirrors the server for the case; returns what still differs. */
export async function converge(
  tabs: Tab[],
  caseId: string,
  timeoutMs: number,
): Promise<Record<string, string[]>> {
  const until = Date.now() + timeoutMs;
  let open: Record<string, string[]> = {};
  for (const tab of tabs) await showAllTasks(tab).catch(() => undefined);
  do {
    open = {};
    const states = await serverStates(tabs, caseId);
    for (const tab of tabs) {
      const diffs = await tabDiff(tab, states.get(tab.user)!, caseId).catch((error: unknown) => [
        `check failed: ${String(error).slice(0, 120)}`,
      ]);
      if (diffs.length) open[tab.tag] = diffs;
    }
    if (Object.keys(open).length === 0) return {};
    await sleep(2_500);
  } while (Date.now() < until);
  // What each tab that is still out of sync shows, for the report.
  for (const tab of tabs.filter((t) => open[t.tag])) {
    const path = test.info().outputPath(`${tab.tag}-out-of-sync-${Date.now()}.png`);
    if (await tab.screenshot({ path }).catch(() => null)) {
      await test.info().attach(`${tab.tag} out of sync`, { path, contentType: "image/png" });
    }
  }
  return open;
}

/** The sync conflict dialog, for a check that it does or does not open. */
export function conflictDialog(tab: Tab) {
  return tab.getByRole("dialog", { name: "Sync conflict" });
}

// --- calendar -----------------------------------------------------------------------------------

/** Where a task's due shows in the Calendar week of `date`: the all-day row, the timed grid, or not. */
export type CalendarSpot = "all-day" | "timed" | "none";

/**
 * Open the Calendar week of `date` (YYYY-MM-DD) in the tab and say where
 * `title` shows, once it shows as `expected` or after 15 s.
 */
export async function calendarSpot(
  tab: Tab,
  date: string,
  title: string,
  expected: CalendarSpot,
): Promise<CalendarSpot> {
  await tab.goto(`/calendar/week/${date}`);
  await tab.locator("time-line.timeline-timed").waitFor({ timeout: 30_000 });
  const cards = tab.locator("event-card").filter({ hasText: title });
  const timed = tab.locator("time-line.timeline-timed event-card").filter({ hasText: title });
  // The overlay paints from the Tasks cache, then again after a live load:
  // give "not there" the time to be wrong.
  if (expected === "none") await sleep(5_000);
  const until = Date.now() + 15_000;
  let spot: CalendarSpot = "none";
  do {
    const [all, inGrid] = [await cards.count(), await timed.count()];
    spot = all === 0 ? "none" : inGrid > 0 ? "timed" : "all-day";
    if (spot === expected) return spot;
    await sleep(1_000);
  } while (Date.now() < until);
  return spot;
}
