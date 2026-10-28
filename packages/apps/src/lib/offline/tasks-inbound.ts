import type { Task, TaskList } from "@/tasks-core/src/tasks-types";
import { listOutboxMutationsForDomain } from "@/lib/offline/core/outbox-store";
import { TASKS_DOMAIN } from "@/lib/offline/tasks/tasks-schema";
import { taskEtag } from "@/lib/offline/tasks/tasks-patch-merge";
import {
  listCachedTasksForList,
  listPendingTaskIds,
  readTasksBootstrapFromCache,
  removeTaskFromCache,
  removeTaskListFromCache,
  tasksOutboxTaskId,
  tasksOutboxTaskListId,
  upsertTaskInCache,
  upsertTaskListInCache,
} from "@/lib/offline/tasks-offline-store";
import { reportTasksSyncConflicts } from "@/lib/offline/tasks-sync-conflicts";

const LIST_OPS = new Set(["listCreate", "listUpdate", "listDelete"]);

type PendingTaskWrite = {
  /** Server etag the first queued write was based on (its If-Match), when known. */
  baseEtag?: string;
  /** A local delete is queued: the user wants the task gone too. */
  deleting: boolean;
};

/** Local writes that inbound must not overwrite. */
export type TasksPendingWrites = {
  tasks: Map<string, PendingTaskWrite>;
  lists: Set<string>;
  /** Lists with a queued delete: their remote tasks must not come back either. */
  deletingLists: Set<string>;
};

/**
 * Queued outbox rows plus `pendingSync` cache rows. A queued delete has no
 * cache row any more, so the outbox is what keeps it from coming back.
 */
export async function readTasksPendingWrites(username: string): Promise<TasksPendingWrites> {
  const tasks = new Map<string, PendingTaskWrite>();
  const lists = new Set<string>();
  const deletingLists = new Set<string>();
  for (const row of await listOutboxMutationsForDomain(username, TASKS_DOMAIN)) {
    if (LIST_OPS.has(row.op)) {
      const listId = tasksOutboxTaskListId(row);
      if (listId) lists.add(listId);
      if (listId && row.op === "listDelete") deletingLists.add(listId);
      continue;
    }
    const taskId = tasksOutboxTaskId(row);
    if (!taskId) continue;
    const previous = tasks.get(taskId);
    tasks.set(taskId, {
      baseEtag: previous?.baseEtag ?? row.ifInState,
      deleting: (previous?.deleting ?? false) || row.op === "delete",
    });
  }
  for (const taskId of await listPendingTaskIds(username)) {
    if (!tasks.has(taskId)) tasks.set(taskId, { deleting: false });
  }
  return { tasks, lists, deletingLists };
}

/** A queued write is a conflict only when the server moved since it was queued. */
function serverMovedSince(write: PendingTaskWrite, remote: Task): boolean {
  const remoteEtag = taskEtag(remote);
  return write.baseEtag !== undefined && remoteEtag !== undefined && remoteEtag !== write.baseEtag;
}

function report(conflicts: string[]): void {
  // An empty report clears the conflict notice, so only report real ids.
  if (conflicts.length > 0) reportTasksSyncConflicts(conflicts);
}

async function ingestTask(
  username: string,
  task: Task,
  pending: TasksPendingWrites,
  conflicts: string[],
): Promise<"upserted" | "skipped-pending"> {
  if (!task.id || pending.deletingLists.has(task.taskListId)) return "skipped-pending";
  const write = pending.tasks.get(task.id);
  if (write) {
    if (serverMovedSince(write, task)) conflicts.push(task.id);
    return "skipped-pending";
  }
  await upsertTaskInCache(username, task, false);
  return "upserted";
}

/**
 * Ingest a remote task into Dexie. A task with a pending local write is not
 * overwritten; when the server changed it since the write was queued, the
 * clash goes through `reportTasksSyncConflicts`.
 */
export async function ingestRemoteTask(
  username: string,
  task: Task,
  pending?: TasksPendingWrites,
): Promise<"upserted" | "skipped-pending"> {
  const conflicts: string[] = [];
  const result = await ingestTask(
    username,
    task,
    pending ?? (await readTasksPendingWrites(username)),
    conflicts,
  );
  report(conflicts);
  return result;
}

/** Drop a remotely destroyed task unless a local pending write still owns the id. */
export async function ingestRemoteTaskDestroyed(
  username: string,
  taskId: string,
  pending?: TasksPendingWrites,
): Promise<"removed" | "skipped-pending"> {
  const write = (pending ?? (await readTasksPendingWrites(username))).tasks.get(taskId);
  if (write) {
    // Deleted on both sides is not a clash.
    if (!write.deleting) report([taskId]);
    return "skipped-pending";
  }
  await removeTaskFromCache(username, taskId);
  return "removed";
}

/** Upsert a remote task list unless a local list write is still queued. */
export async function ingestRemoteTaskList(
  username: string,
  list: TaskList,
  pending?: TasksPendingWrites,
): Promise<"upserted" | "skipped-pending"> {
  if (!list.id) return "skipped-pending";
  if ((pending ?? (await readTasksPendingWrites(username))).lists.has(list.id)) {
    return "skipped-pending";
  }
  await upsertTaskListInCache(username, list);
  return "upserted";
}

/**
 * Drop a remotely destroyed task list and its cached tasks. Tasks with a
 * pending write stay so flush and conflict handling can run.
 */
export async function ingestRemoteTaskListDestroyed(
  username: string,
  taskListId: string,
  pending?: TasksPendingWrites,
): Promise<"removed"> {
  const writes = pending ?? (await readTasksPendingWrites(username));
  const conflicts: string[] = [];
  for (const task of await listCachedTasksForList(username, taskListId)) {
    const write = writes.tasks.get(task.id);
    if (write) {
      if (!write.deleting) conflicts.push(task.id);
      continue;
    }
    await removeTaskFromCache(username, task.id);
  }
  report(conflicts);
  await removeTaskListFromCache(username, taskListId);
  return "removed";
}

/**
 * Reconcile one task list after a full re-list of its tasks: upsert what the
 * server has, drop cached tasks of this list it no longer has. A pending task
 * missing from the list is left alone: it may be a queued move into this list.
 */
export async function reconcileTaskListResync(
  username: string,
  taskListId: string,
  remoteTasks: Task[],
  pending?: TasksPendingWrites,
): Promise<void> {
  const writes = pending ?? (await readTasksPendingWrites(username));
  if (writes.deletingLists.has(taskListId)) return;
  const conflicts: string[] = [];
  const remoteIds = new Set<string>();
  for (const task of remoteTasks) {
    if (task.id) remoteIds.add(task.id);
    await ingestTask(username, task, writes, conflicts);
  }
  for (const cached of await listCachedTasksForList(username, taskListId)) {
    if (remoteIds.has(cached.id) || writes.tasks.has(cached.id)) continue;
    await removeTaskFromCache(username, cached.id);
  }
  report(conflicts);
}

/**
 * Full snapshot after `cannotCalculateChanges`: upsert remote lists and tasks,
 * then drop cached lists and tasks the server no longer has. Pending writes stay.
 */
export async function reconcileTasksSnapshot(
  username: string,
  lists: TaskList[],
  tasks: Task[],
): Promise<void> {
  const writes = await readTasksPendingWrites(username);
  const cached = await readTasksBootstrapFromCache(username);
  const conflicts: string[] = [];
  const remoteListIds = new Set(lists.map((list) => list.id).filter(Boolean));
  const remoteTaskIds = new Set(tasks.map((task) => task.id).filter(Boolean));

  for (const list of lists) {
    await ingestRemoteTaskList(username, list, writes);
  }
  for (const task of tasks) {
    await ingestTask(username, task, writes, conflicts);
  }
  for (const task of cached?.data.tasks ?? []) {
    if (!task.id || remoteTaskIds.has(task.id) || writes.tasks.has(task.id)) continue;
    await removeTaskFromCache(username, task.id);
  }
  for (const list of cached?.data.taskLists ?? []) {
    if (!list.id || remoteListIds.has(list.id) || writes.lists.has(list.id)) continue;
    await removeTaskListFromCache(username, list.id);
  }
  report(conflicts);
}
