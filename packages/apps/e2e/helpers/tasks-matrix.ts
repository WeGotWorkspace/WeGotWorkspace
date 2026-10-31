// Helpers for the Tasks sync matrix (`tasks-sync-matrix.spec.ts`): the server
// state of one case, each tab's offline cache and view, and "does every tab
// match the server". Every list and task of a case carries the case id in its
// name, so a case only ever looks at its own rows.
import type { BrowserContext } from "@playwright/test";
import { api, OWNER, sleep, type Tab } from "./live-matrix";

export { api, openUser, OWNER, setTabOffline, sleep, type Tab } from "./live-matrix";

/** One inbound poll (10 s) plus the time to re-list and paint. */
export const POLL_MS = 10_000;

// --- server -------------------------------------------------------------------------------------

export type ServerTask = {
  id: string;
  title: string;
  listId: string;
  completed: boolean;
  etag: string;
};
export type ServerList = { id: string; name: string };
export type ServerState = { lists: ServerList[]; tasks: ServerTask[] };

type RawTask = {
  id: string;
  title?: string | null;
  taskListId: string;
  workflowStatus?: string | null;
  etag?: string;
};

function toServerTask(task: RawTask): ServerTask {
  return {
    id: task.id,
    title: task.title ?? "",
    listId: task.taskListId,
    completed: task.workflowStatus === "completed",
    etag: task.etag ?? "",
  };
}

function ok(res: { status: number; json: unknown }, what: string, codes = [200, 201, 204]) {
  if (!codes.includes(res.status)) {
    throw new Error(`${what}: ${res.status} ${JSON.stringify(res.json).slice(0, 200)}`);
  }
}

export async function createList(name: string): Promise<string> {
  const res = await api(OWNER, "POST", "/tasks/tasklists", { name });
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

export async function createTask(listId: string, title: string): Promise<ServerTask> {
  const res = await api(OWNER, "POST", "/tasks/items", { taskListIds: { [listId]: true }, title });
  ok(res, `create task ${title}`);
  return toServerTask(res.json as RawTask);
}

export async function serverTask(taskId: string): Promise<ServerTask | null> {
  const res = await api(OWNER, "GET", `/tasks/items/${encodeURIComponent(taskId)}`);
  if (res.status === 404) return null;
  ok(res, `get task ${taskId}`);
  return toServerTask(res.json as RawTask);
}

/** Change a task the way another client does: against its current etag. */
export async function patchTask(taskId: string, patch: Record<string, unknown>): Promise<void> {
  const current = await serverTask(taskId);
  if (!current) throw new Error(`patch task ${taskId}: gone`);
  const res = await api(OWNER, "PATCH", `/tasks/items/${encodeURIComponent(taskId)}`, patch, {
    "If-Match": current.etag,
  });
  ok(res, `patch task ${taskId}`);
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
 * The owner's lists and tasks whose name carries `caseId`. A case only puts
 * tasks on its own lists, so only those are listed: the API allows one user
 * 600 requests a minute, shared with every open tab.
 */
export async function serverState(caseId: string): Promise<ServerState> {
  const res = await api(OWNER, "GET", "/tasks/tasklists");
  ok(res, "list task lists");
  const lists = ((res.json as { list?: Array<{ id: string; name: string }> }).list ?? [])
    .map((list) => ({ id: list.id, name: list.name }))
    .filter((list) => list.name.includes(caseId));
  const tasks: ServerTask[] = [];
  for (const list of lists) {
    const items = await api(OWNER, "GET", `/tasks/items?taskListId=${encodeURIComponent(list.id)}`);
    if (items.status === 404) continue;
    ok(items, `list tasks of ${list.id}`);
    for (const task of (items.json as { list?: RawTask[] }).list ?? []) {
      if ((task.title ?? "").includes(caseId)) tasks.push(toServerTask(task));
    }
  }
  return { lists, tasks };
}

/** Remove every list of a case, with its tasks. */
export async function cleanUpCase(caseId: string): Promise<void> {
  const state = await serverState(caseId).catch(() => null);
  for (const list of state?.lists ?? []) await deleteList(list.id);
}

// --- tabs ---------------------------------------------------------------------------------------

/** A Tasks tab that records page errors, console errors and failed requests into `events`. */
export async function openTasksTab(
  context: BrowserContext,
  tag: string,
  events: string[],
): Promise<Tab> {
  const page = (await context.newPage()) as Tab;
  page.tag = tag;
  page.user = OWNER;
  page.on("pageerror", (error) => events.push(`${tag} page error: ${String(error).slice(0, 160)}`));
  page.on("console", (message) => {
    if (message.type() === "error") events.push(`${tag} console: ${message.text().slice(0, 160)}`);
  });
  page.on("requestfailed", (request) => {
    const url = request.url().replace(/^https?:\/\/[^/]+/, "");
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

export type TabCache = {
  missingDb?: boolean;
  lists: ServerList[];
  tasks: Array<Omit<ServerTask, "etag"> & { pending: boolean }>;
  /** Every queued Tasks write, as `op` or `op (status error)` after a failed send. */
  outbox: string[];
  token: string | null;
};

/** The tab's Tasks cache, limited to rows that carry `caseId`. */
export async function tabCache(tab: Tab, caseId: string): Promise<TabCache> {
  return tab.evaluate(async (id) => {
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
      const list = JSON.parse(row.data) as { name?: string };
      return { id: row.id, name: list.name ?? "" };
    });
    const tasks = (await all<{ id: string; data: string; pendingSync: boolean }>("tasks_items"))
      .map((row) => {
        const task = JSON.parse(row.data) as {
          title?: string;
          taskListId: string;
          workflowStatus?: string | null;
        };
        return {
          id: row.id,
          title: task.title ?? "",
          listId: task.taskListId,
          completed: task.workflowStatus === "completed",
          pending: row.pendingSync,
        };
      })
      .filter((task) => task.title.includes(id));
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

/** List names the tab's sidebar shows. */
export async function shownLists(tab: Tab, caseId: string): Promise<string[]> {
  const names = await tab
    .getByRole("region", { name: "My lists" })
    .getByRole("listitem")
    .evaluateAll((els) =>
      els.map((el) => el.querySelector("button:not([aria-label])")?.textContent?.trim() ?? ""),
    );
  return names.filter((name) => name.includes(caseId)).sort();
}

export async function showAllTasks(tab: Tab): Promise<void> {
  await tab.getByRole("button", { name: "All Tasks" }).click();
  await sleep(300);
}

// --- convergence --------------------------------------------------------------------------------

const sameSet = (a: string[], b: string[]) => a.join("\n") === b.join("\n");

/** What a tab's cache and view show that differs from the server. Empty means in sync. */
export async function tabDiff(tab: Tab, want: ServerState, caseId: string): Promise<string[]> {
  const have = await tabCache(tab, caseId);
  if (have.missingDb) return ["no offline cache"];
  const diffs: string[] = [];
  if (have.outbox.length) diffs.push(`outbox: ${have.outbox.join(", ")}`);

  for (const list of want.lists) {
    const row = have.lists.find((entry) => entry.id === list.id);
    if (!row) diffs.push(`cache lacks list "${list.name}"`);
    else if (row.name !== list.name) diffs.push(`list "${row.name}" ≠ "${list.name}"`);
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
    if (row.title !== task.title) diffs.push(`title "${row.title}" ≠ "${task.title}"`);
    if (row.listId !== task.listId)
      diffs.push(`"${task.title}" list ${row.listId} ≠ ${task.listId}`);
    if (row.completed !== task.completed) {
      diffs.push(`"${task.title}" completed ${row.completed} ≠ ${task.completed}`);
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
    const want = await serverState(caseId);
    for (const tab of tabs) {
      const diffs = await tabDiff(tab, want, caseId).catch((error: unknown) => [
        `check failed: ${String(error).slice(0, 120)}`,
      ]);
      if (diffs.length) open[tab.tag] = diffs;
    }
    if (Object.keys(open).length === 0) return {};
    await sleep(2_500);
  } while (Date.now() < until);
  return open;
}

/** The sync conflict dialog, for a check that it does or does not open. */
export function conflictDialog(tab: Tab) {
  return tab.getByRole("dialog", { name: "Sync conflict" });
}
