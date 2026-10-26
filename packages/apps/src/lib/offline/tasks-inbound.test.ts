import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OfflineOutboxRow } from "@/lib/offline/core/types";
import type { Task, TaskList } from "@/tasks-core/src/tasks-types";
import {
  ingestRemoteTask,
  ingestRemoteTaskDestroyed,
  ingestRemoteTaskList,
  ingestRemoteTaskListDestroyed,
  reconcileTaskListResync,
  reconcileTasksSnapshot,
} from "@/lib/offline/tasks-inbound";

const outboxRows = vi.fn<() => Promise<OfflineOutboxRow[]>>();
const listPending = vi.fn<() => Promise<string[]>>();
const upsert = vi.fn();
const remove = vi.fn();
const upsertList = vi.fn();
const removeList = vi.fn();
const listTasksForList = vi.fn<() => Promise<Task[]>>();
const readCache = vi.fn<() => Promise<{ data: { tasks: Task[]; taskLists: TaskList[] } } | null>>();
const reportConflicts = vi.fn();

vi.mock("@/lib/offline/core/outbox-store", () => ({
  listOutboxMutationsForDomain: () => outboxRows(),
}));

vi.mock("@/lib/offline/tasks-offline-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/offline/tasks-offline-store")>();
  return {
    tasksOutboxTaskId: actual.tasksOutboxTaskId,
    tasksOutboxTaskListId: actual.tasksOutboxTaskListId,
    listPendingTaskIds: () => listPending(),
    upsertTaskInCache: (...args: unknown[]) => upsert(...args),
    removeTaskFromCache: (...args: unknown[]) => remove(...args),
    upsertTaskListInCache: (...args: unknown[]) => upsertList(...args),
    removeTaskListFromCache: (...args: unknown[]) => removeList(...args),
    listCachedTasksForList: () => listTasksForList(),
    readTasksBootstrapFromCache: () => readCache(),
  };
});

vi.mock("@/lib/offline/tasks-sync-conflicts", () => ({
  reportTasksSyncConflicts: (...args: unknown[]) => reportConflicts(...args),
}));

function task(id: string, title: string, etag: string, taskListId = "inbox"): Task {
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
    etag,
  } as Task;
}

function list(id: string, name: string): TaskList {
  return {
    id,
    name,
    color: null,
    scope: "personal",
    groupSlug: null,
    sortOrder: 0,
    isDefault: false,
    isSubscribed: true,
  } as TaskList;
}

function outbox(
  op: string,
  payload: Record<string, unknown>,
  ifInState?: string,
): OfflineOutboxRow {
  return {
    id: `row-${op}-${JSON.stringify(payload)}`,
    domain: "tasks",
    op,
    payload: JSON.stringify(payload),
    ifInState,
  } as OfflineOutboxRow;
}

describe("tasks-inbound", () => {
  beforeEach(() => {
    for (const mock of [
      outboxRows,
      listPending,
      upsert,
      remove,
      upsertList,
      removeList,
      listTasksForList,
      readCache,
      reportConflicts,
    ]) {
      mock.mockReset();
    }
    outboxRows.mockResolvedValue([]);
    listPending.mockResolvedValue([]);
    listTasksForList.mockResolvedValue([]);
    readCache.mockResolvedValue({ data: { tasks: [], taskLists: [] } });
  });

  it("remote rename updates a task with no local write", async () => {
    const renamed = task("t1", "Renamed elsewhere", "e2");
    await expect(ingestRemoteTask("ada", renamed)).resolves.toBe("upserted");
    expect(upsert).toHaveBeenCalledWith("ada", renamed, false);
    expect(reportConflicts).not.toHaveBeenCalled();
  });

  it("remote delete removes a task with no local write", async () => {
    await expect(ingestRemoteTaskDestroyed("ada", "t1")).resolves.toBe("removed");
    expect(remove).toHaveBeenCalledWith("ada", "t1");
  });

  it("a pending local edit is not overwritten and raises a conflict when the server moved", async () => {
    outboxRows.mockResolvedValue([
      outbox("update", { taskId: "t1", patch: { title: "Mine" } }, "e1"),
    ]);
    listPending.mockResolvedValue(["t1"]);
    await expect(ingestRemoteTask("ada", task("t1", "Theirs", "e2"))).resolves.toBe(
      "skipped-pending",
    );
    expect(upsert).not.toHaveBeenCalled();
    expect(reportConflicts).toHaveBeenCalledWith(["t1"]);
  });

  it("a pending local edit is not a conflict while the server still has its base version", async () => {
    outboxRows.mockResolvedValue([
      outbox("update", { taskId: "t1", patch: { title: "Mine" } }, "e1"),
    ]);
    listPending.mockResolvedValue(["t1"]);
    await expect(ingestRemoteTask("ada", task("t1", "Old", "e1"))).resolves.toBe("skipped-pending");
    expect(upsert).not.toHaveBeenCalled();
    expect(reportConflicts).not.toHaveBeenCalled();
  });

  it("a queued local delete is not brought back by a remote update", async () => {
    // The queued delete already removed the cache row; only the outbox knows.
    outboxRows.mockResolvedValue([outbox("delete", { taskId: "t1" }, "e1")]);
    await expect(ingestRemoteTask("ada", task("t1", "Still there", "e1"))).resolves.toBe(
      "skipped-pending",
    );
    expect(upsert).not.toHaveBeenCalled();
  });

  it("deleted on both sides is not a conflict", async () => {
    outboxRows.mockResolvedValue([outbox("delete", { taskId: "t1" }, "e1")]);
    await expect(ingestRemoteTaskDestroyed("ada", "t1")).resolves.toBe("skipped-pending");
    expect(remove).not.toHaveBeenCalled();
    expect(reportConflicts).not.toHaveBeenCalled();
  });

  it("a remote delete of a locally edited task keeps it and raises a conflict", async () => {
    outboxRows.mockResolvedValue([outbox("update", { taskId: "t1", patch: {} }, "e1")]);
    listPending.mockResolvedValue(["t1"]);
    await expect(ingestRemoteTaskDestroyed("ada", "t1")).resolves.toBe("skipped-pending");
    expect(remove).not.toHaveBeenCalled();
    expect(reportConflicts).toHaveBeenCalledWith(["t1"]);
  });

  it("upserts a remote list unless a list write is queued", async () => {
    await expect(ingestRemoteTaskList("ada", list("inbox", "Inbox"))).resolves.toBe("upserted");
    expect(upsertList).toHaveBeenCalledWith("ada", list("inbox", "Inbox"));

    upsertList.mockReset();
    outboxRows.mockResolvedValue([
      outbox("listUpdate", { taskListId: "inbox", patch: { name: "Mine" } }),
    ]);
    await expect(ingestRemoteTaskList("ada", list("inbox", "Theirs"))).resolves.toBe(
      "skipped-pending",
    );
    expect(upsertList).not.toHaveBeenCalled();
  });

  it("a destroyed list removes its tasks except pending ones", async () => {
    outboxRows.mockResolvedValue([outbox("update", { taskId: "t-pending", patch: {} }, "e1")]);
    listPending.mockResolvedValue(["t-pending"]);
    listTasksForList.mockResolvedValue([
      task("t-gone", "Gone", "e1", "work"),
      task("t-pending", "Edited here", "e1", "work"),
    ]);
    await expect(ingestRemoteTaskListDestroyed("ada", "work")).resolves.toBe("removed");
    expect(remove).toHaveBeenCalledWith("ada", "t-gone");
    expect(remove).not.toHaveBeenCalledWith("ada", "t-pending");
    expect(reportConflicts).toHaveBeenCalledWith(["t-pending"]);
    expect(removeList).toHaveBeenCalledWith("ada", "work");
  });

  it("list resync upserts remote tasks and drops cached tasks the list no longer has", async () => {
    listTasksForList.mockResolvedValue([
      task("t1", "Old title", "e1"),
      task("t-gone", "Deleted elsewhere", "e1"),
    ]);
    const renamed = task("t1", "New title", "e2");
    await reconcileTaskListResync("ada", "inbox", [renamed]);
    expect(upsert).toHaveBeenCalledWith("ada", renamed, false);
    expect(remove).toHaveBeenCalledWith("ada", "t-gone");
    expect(remove).not.toHaveBeenCalledWith("ada", "t1");
  });

  it("list resync keeps a pending task the list does not have (a queued move or create)", async () => {
    listPending.mockResolvedValue(["local-abc"]);
    listTasksForList.mockResolvedValue([task("local-abc", "Created offline", "local-etag")]);
    await reconcileTaskListResync("ada", "inbox", []);
    expect(remove).not.toHaveBeenCalled();
    expect(reportConflicts).not.toHaveBeenCalled();
  });

  it("list resync skips a list whose delete is queued", async () => {
    outboxRows.mockResolvedValue([
      outbox("listDelete", { taskListId: "work", onDestroyRemoveContents: true }),
    ]);
    await reconcileTaskListResync("ada", "work", [task("t1", "Server copy", "e1", "work")]);
    expect(upsert).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("snapshot reconcile drops cached lists and tasks the server no longer has", async () => {
    listPending.mockResolvedValue(["t-pending"]);
    readCache.mockResolvedValue({
      data: {
        taskLists: [list("inbox", "Inbox"), list("gone", "Gone")],
        tasks: [
          task("t1", "Kept", "e1"),
          task("t-stale", "Stale", "e1", "gone"),
          task("t-pending", "Pending", "e1", "gone"),
        ],
      },
    });
    const kept = task("t1", "Kept", "e1");
    await reconcileTasksSnapshot("ada", [list("inbox", "Inbox")], [kept]);
    expect(upsertList).toHaveBeenCalledWith("ada", list("inbox", "Inbox"));
    expect(upsert).toHaveBeenCalledWith("ada", kept, false);
    expect(remove).toHaveBeenCalledWith("ada", "t-stale");
    expect(remove).not.toHaveBeenCalledWith("ada", "t-pending");
    expect(removeList).toHaveBeenCalledWith("ada", "gone");
  });
});
