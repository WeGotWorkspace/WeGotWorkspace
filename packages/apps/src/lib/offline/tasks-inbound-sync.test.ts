import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTasksAppBootstrap, type TasksAppBootstrap } from "@/lib/api/mock/tasks-bootstrap";
import type { Task, TaskList } from "@/tasks-core/src/tasks-types";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import { tasksItemsTable, tasksListsTable } from "@/lib/offline/tasks/tasks-schema";
import {
  listOutboxMutations,
  readTasksBootstrapFromCache,
  readTasksChangesState,
  writeTasksChangesState,
} from "@/lib/offline/tasks-offline-store";
import { setTasksSyncConflictListener } from "@/lib/offline/tasks-sync-conflicts";
import {
  createHybridTasksOperations,
  fetchTasksHybridBootstrap,
} from "@/lib/offline/tasks-hybrid-operations";
import { syncTasksInbound } from "@/lib/offline/tasks-inbound-sync";

/**
 * In-memory Tasks server. `changes` follows TaskListRepository::changes: the
 * state maps each list to its sync token, and any task change bumps the token
 * of its list. Another tab, phone or CalDAV client edits through this object.
 */
class FakeTasksServer {
  lists = new Map<string, TaskList>();
  tasks = new Map<string, Task>();
  private tokens = new Map<string, number>();
  private etags = 0;

  addList(list: TaskList) {
    this.lists.set(list.id, list);
    this.tokens.set(list.id, 1);
  }

  putTask(task: Task) {
    this.tasks.set(task.id, { ...task, etag: `"e${++this.etags}"` } as Task);
    this.bump(task.taskListId);
  }

  renameTask(taskId: string, title: string) {
    this.putTask({ ...this.tasks.get(taskId)!, title });
  }

  deleteTask(taskId: string) {
    const task = this.tasks.get(taskId)!;
    this.tasks.delete(taskId);
    this.bump(task.taskListId);
  }

  deleteList(listId: string) {
    this.lists.delete(listId);
    this.tokens.delete(listId);
    for (const task of [...this.tasks.values()]) {
      if (task.taskListId === listId) this.tasks.delete(task.id);
    }
  }

  private bump(listId: string) {
    this.tokens.set(listId, (this.tokens.get(listId) ?? 0) + 1);
  }

  state(): string {
    return JSON.stringify(Object.fromEntries([...this.tokens].sort()));
  }

  changes(since?: string | null) {
    const newState = this.state();
    if (!since) {
      return {
        oldState: "0",
        newState,
        created: [...this.tokens.keys()],
        updated: [],
        destroyed: [],
      };
    }
    let previous: Record<string, number>;
    try {
      previous = JSON.parse(since) as Record<string, number>;
    } catch {
      throw new TasksRequestError(
        "GET /tasks/tasklists/changes failed (400)",
        400,
        "cannotCalculateChanges",
      );
    }
    const created: string[] = [];
    const updated: string[] = [];
    for (const [id, token] of this.tokens) {
      if (!(id in previous)) created.push(id);
      else if (previous[id] !== token) updated.push(id);
    }
    const destroyed = Object.keys(previous).filter((id) => !this.tokens.has(id));
    return { oldState: since, newState, created, updated, destroyed };
  }

  listTasks(taskListId: string): Task[] {
    return [...this.tasks.values()].filter((task) => task.taskListId === taskListId);
  }
}

let server = new FakeTasksServer();
const username = "inbound-user";
const session = createTasksAppBootstrap().session;
const bootstrapSession: TasksAppBootstrap["session"] = {
  ...session,
  user: { ...session.user, username },
};

// When set, bounded waits for the outbox lock give up, as if another tab held it.
let lockBusy = false;
vi.mock("@/lib/offline/core/connectivity-sync-runner", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/offline/core/connectivity-sync-runner")>();
  const { CrossTabLockTimeoutError } = await import("@/lib/offline/core/cross-tab-lock");
  return {
    ...real,
    withOutboxLock: ((domain, user, task, options) =>
      lockBusy && options?.maxWaitMs !== undefined
        ? Promise.reject(new CrossTabLockTimeoutError("outbox"))
        : real.withOutboxLock(domain, user, task, options)) as typeof real.withOutboxLock,
  };
});

// The test environment has no window, so the remembered account is stubbed.
vi.mock("@/lib/offline/offline-session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/offline/offline-session")>()),
  readOfflineTasksUsername: () => username,
}));

vi.mock("@/lib/offline/core/browser-online", () => ({
  readBrowserOnline: vi.fn(() => true),
  isFetchNetworkError: vi.fn((error: unknown) => error instanceof TypeError),
  subscribeBrowserOnline: vi.fn(() => () => undefined),
}));

vi.mock("@/lib/api/wgw/tasks", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api/wgw/tasks")>();
  return {
    ...real,
    listTaskListChanges: vi.fn(async (since?: string | null) => server.changes(since)),
    listTaskLists: vi.fn(async () => [...server.lists.values()]),
    listTasks: vi.fn(async ({ taskListId }: { taskListId: string }) =>
      server.listTasks(taskListId),
    ),
    fetchTasksLiveBootstrap: vi.fn(async () => ({
      session: bootstrapSession,
      data: {
        taskLists: [...server.lists.values()],
        tasks: [...server.tasks.values()],
        groups: [],
      },
    })),
    // Writes from this tab only happen offline in these tests.
    patchTask: vi.fn(async () => {
      throw new TypeError("network down");
    }),
    deleteTask: vi.fn(async () => {
      throw new TypeError("network down");
    }),
  };
});

import {
  fetchTasksLiveBootstrap,
  listTaskListChanges,
  listTasks,
  TasksRequestError,
} from "@/lib/api/wgw/tasks";
import { readBrowserOnline } from "@/lib/offline/core/browser-online";

function list(id: string, name: string): TaskList {
  return {
    id,
    name,
    color: null,
    scope: "personal",
    groupSlug: null,
    sortOrder: 0,
    isDefault: id === "inbox",
    isSubscribed: true,
  } as TaskList;
}

function task(id: string, title: string, taskListId = "inbox"): Task {
  return {
    "@type": "Task",
    id,
    taskListId,
    uid: `urn:uuid:${id}`,
    title,
    description: null,
    due: null,
    workflowStatus: "needs-action",
    priority: null,
    isDraft: false,
    sortOrder: 0,
    categories: [],
  } as Task;
}

async function cachedTitles(): Promise<Record<string, Task["title"]>> {
  const cached = await readTasksBootstrapFromCache(username);
  return Object.fromEntries((cached?.data.tasks ?? []).map((entry) => [entry.id, entry.title]));
}

async function cachedListIds(): Promise<string[]> {
  const cached = await readTasksBootstrapFromCache(username);
  return (cached?.data.taskLists ?? []).map((entry) => entry.id).sort();
}

/** Tab A while offline: the real hybrid operations queue the write. */
async function offline<T>(write: () => Promise<T>): Promise<T> {
  vi.mocked(readBrowserOnline).mockReturnValue(false);
  try {
    return await write();
  } finally {
    vi.mocked(readBrowserOnline).mockReturnValue(true);
  }
}

describe("syncTasksInbound (tab A follows server changes without a reload)", () => {
  let conflicts: string[][];

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(readBrowserOnline).mockReturnValue(true);
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await db.outbox.clear();
    await tasksItemsTable(db).clear();
    await tasksListsTable(db).clear();
    await db.meta.clear();

    server = new FakeTasksServer();
    server.addList(list("inbox", "Inbox"));
    server.addList(list("work", "Work"));
    server.putTask(task("t-rename", "Buy milk"));
    server.putTask(task("t-delete", "Call Bob"));
    server.putTask(task("t-keep", "Water plants"));
    server.putTask(task("t-work", "Write report", "work"));

    conflicts = [];
    // The outbox flush reports [] to clear the notice; only real conflicts count here.
    setTasksSyncConflictListener((ids) => {
      if (ids.length > 0) conflicts.push(ids);
    });

    // Tab A loads the page: snapshot plus the changes state it reflects.
    await fetchTasksHybridBootstrap();
    vi.mocked(listTasks).mockClear();
  });

  it("the page load stores the changes state with the snapshot", async () => {
    expect(await readTasksChangesState(username)).toBe(server.state());
  });

  it("a task deleted and one renamed in another tab update in tab A", async () => {
    server.deleteTask("t-delete");
    server.renameTask("t-rename", "Buy oat milk");

    const result = await syncTasksInbound(username);

    expect(result).toEqual({ changed: true, usedFullResync: false });
    expect(await cachedTitles()).toEqual({
      "t-rename": "Buy oat milk",
      "t-keep": "Water plants",
      "t-work": "Write report",
    });
    // Only the list that changed is re-listed.
    expect(vi.mocked(listTasks).mock.calls.map(([opts]) => opts.taskListId)).toEqual(["inbox"]);
    expect(await readTasksChangesState(username)).toBe(server.state());
    expect(conflicts).toEqual([]);
  });

  it("a new task from another tab appears", async () => {
    server.putTask(task("t-new", "Book flights", "work"));
    await syncTasksInbound(username);
    expect((await cachedTitles())["t-new"]).toBe("Book flights");
  });

  it("nothing changed: no re-list and no cache write", async () => {
    await expect(syncTasksInbound(username)).resolves.toEqual({
      changed: false,
      usedFullResync: false,
    });
    expect(listTasks).not.toHaveBeenCalled();
  });

  it("a queued change survives reconciliation", async () => {
    const operations = createHybridTasksOperations(username);
    await offline(() => operations.patchTask("t-rename", { title: "Buy soy milk" }));
    // Meanwhile another tab renames the same task and deletes one next to it.
    server.renameTask("t-rename", "Buy oat milk");
    server.deleteTask("t-delete");

    await syncTasksInbound(username);

    const titles = await cachedTitles();
    expect(titles["t-rename"]).toBe("Buy soy milk");
    expect(titles["t-delete"]).toBeUndefined();
    const queued = await listOutboxMutations(username);
    expect(queued.map((row) => [row.op, JSON.parse(row.payload).taskId])).toEqual([
      ["update", "t-rename"],
    ]);
    // The server moved since the edit was queued: the Tasks conflict flow takes it.
    expect(conflicts).toEqual([["t-rename"]]);
  });

  it("a queued edit is not a conflict when the server copy did not change", async () => {
    const operations = createHybridTasksOperations(username);
    await offline(() => operations.patchTask("t-rename", { title: "Buy soy milk" }));
    server.deleteTask("t-delete");

    await syncTasksInbound(username);

    expect((await cachedTitles())["t-rename"]).toBe("Buy soy milk");
    expect(conflicts).toEqual([]);
  });

  it("a queued delete is not brought back by the re-list", async () => {
    const operations = createHybridTasksOperations(username);
    await offline(() => operations.deleteTask("t-keep"));
    server.renameTask("t-rename", "Buy oat milk");

    await syncTasksInbound(username);

    const titles = await cachedTitles();
    expect(titles["t-keep"]).toBeUndefined();
    expect(titles["t-rename"]).toBe("Buy oat milk");
    const queued = await listOutboxMutations(username);
    expect(queued.map((row) => row.op)).toEqual(["delete"]);
  });

  it("a bootstrap snapshot overtaken by a pull is not written", async () => {
    server.renameTask("t-rename", "Buy oat milk");
    const staleSnapshot = {
      session: bootstrapSession,
      data: {
        taskLists: [...server.lists.values()],
        tasks: [task("t-rename", "Buy milk")],
        groups: [],
      },
    };
    // The pull lands after the bootstrap read the stored token, before it writes.
    vi.mocked(fetchTasksLiveBootstrap).mockImplementationOnce(async () => {
      await syncTasksInbound(username);
      return staleSnapshot;
    });
    vi.mocked(listTaskListChanges).mockResolvedValueOnce({
      newState: "older-token",
    } as Awaited<ReturnType<typeof listTaskListChanges>>);

    const bootstrap = await fetchTasksHybridBootstrap();

    expect(await readTasksChangesState(username)).toBe(server.state());
    expect((await cachedTitles())["t-rename"]).toBe("Buy oat milk");
    expect(bootstrap.data.tasks.find((entry) => entry.id === "t-rename")?.title).toBe(
      "Buy oat milk",
    );
  });

  it("a snapshot newer than the stored token is written when no pull ran", async () => {
    server.renameTask("t-rename", "Buy oat milk");
    server.deleteTask("t-delete");
    vi.mocked(fetchTasksLiveBootstrap).mockResolvedValueOnce({
      session: bootstrapSession,
      data: {
        taskLists: [...server.lists.values()],
        tasks: [...server.tasks.values()],
        groups: [],
      },
    });

    const bootstrap = await fetchTasksHybridBootstrap();

    expect(await readTasksChangesState(username)).toBe(server.state());
    const titles = await cachedTitles();
    expect(titles["t-rename"]).toBe("Buy oat milk");
    expect(titles["t-delete"]).toBeUndefined();
    expect(bootstrap.data.tasks.find((entry) => entry.id === "t-rename")?.title).toBe(
      "Buy oat milk",
    );
  });

  it("a lock timeout writes neither the snapshot nor the state", async () => {
    server.renameTask("t-rename", "Buy oat milk");
    await syncTasksInbound(username);
    const stored = await readTasksChangesState(username);
    vi.mocked(fetchTasksLiveBootstrap).mockResolvedValueOnce({
      session: bootstrapSession,
      data: {
        taskLists: [...server.lists.values()],
        tasks: [task("t-rename", "Buy milk")],
        groups: [],
      },
    });
    lockBusy = true;
    let bootstrap: Awaited<ReturnType<typeof fetchTasksHybridBootstrap>>;
    try {
      bootstrap = await fetchTasksHybridBootstrap();
    } finally {
      lockBusy = false;
    }
    expect(bootstrap.data.tasks.find((entry) => entry.id === "t-rename")?.title).toBe(
      "Buy oat milk",
    );

    expect(await readTasksChangesState(username)).toBe(stored);
    expect((await cachedTitles())["t-rename"]).toBe("Buy oat milk");
  });

  it("a failed pull leaves the cache and the state as they are", async () => {
    const before = await readTasksChangesState(username);
    server.deleteTask("t-delete");
    vi.mocked(listTasks).mockRejectedValueOnce(new TypeError("network down"));

    await expect(syncTasksInbound(username)).rejects.toThrow("network down");

    expect((await cachedTitles())["t-delete"]).toBe("Call Bob");
    expect(await readTasksChangesState(username)).toBe(before);

    // The next poll catches up.
    await syncTasksInbound(username);
    expect((await cachedTitles())["t-delete"]).toBeUndefined();
  });

  it("a list deleted elsewhere goes away with its tasks, except pending ones", async () => {
    server.putTask(task("t-work-2", "Plan sprint", "work"));
    await syncTasksInbound(username);
    const operations = createHybridTasksOperations(username);
    await offline(() => operations.patchTask("t-work-2", { title: "Plan the sprint" }));
    server.deleteList("work");

    await syncTasksInbound(username);

    expect(await cachedListIds()).toEqual(["inbox"]);
    const titles = await cachedTitles();
    expect(titles["t-work"]).toBeUndefined();
    expect(titles["t-work-2"]).toBe("Plan the sprint");
    expect(conflicts).toEqual([["t-work-2"]]);
  });

  it("cannotCalculateChanges falls back to the full snapshot, keeping queued writes", async () => {
    const operations = createHybridTasksOperations(username);
    await offline(() => operations.patchTask("t-keep", { title: "Water all plants" }));
    await writeTasksChangesState(username, "expired-state");
    server.deleteTask("t-delete");
    server.renameTask("t-rename", "Buy oat milk");

    await expect(syncTasksInbound(username)).resolves.toEqual({
      changed: true,
      usedFullResync: true,
    });

    expect(await cachedTitles()).toEqual({
      "t-rename": "Buy oat milk",
      "t-keep": "Water all plants",
      "t-work": "Write report",
    });
    expect(await readTasksChangesState(username)).toBe(server.state());
  });

  it("with no stored state it takes the full snapshot", async () => {
    await writeTasksChangesState(username, null);
    server.deleteTask("t-delete");

    await expect(syncTasksInbound(username)).resolves.toMatchObject({ usedFullResync: true });
    expect((await cachedTitles())["t-delete"]).toBeUndefined();
    expect(await readTasksChangesState(username)).toBe(server.state());
  });
});
