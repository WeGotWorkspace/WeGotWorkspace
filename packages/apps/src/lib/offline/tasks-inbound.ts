import type { Task, TaskList } from "@/tasks-core/src/tasks-types";
import {
  listRemovedIds,
  readPendingWrites,
  serverMovedSince,
  type PendingWrite,
} from "@/lib/offline/core/inbound-sync";
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

type PendingTaskWrite = PendingWrite;

/** Local writes that inbound must not overwrite. */
export type TasksPendingWrites = {
  tasks: Map<string, PendingTaskWrite>;
  lists: Set<string>;
  /** Lists with a queued delete: their remote tasks must not come back either. */
  deletingLists: Set<string>;
};

/**
 * Queued outbox rows plus `pendingSync` cache rows, through the shared inbound
 * engine. A queued delete has no cache row any more, so the outbox is what keeps
 * it from coming back.
 */
export async function readTasksPendingWrites(username: string): Promise<TasksPendingWrites> {
  const rows = await listOutboxMutationsForDomain(username, TASKS_DOMAIN);
  const tasks = readPendingWrites(
    rows,
    (row) => ({
      id: LIST_OPS.has(row.op) ? null : tasksOutboxTaskId(row),
      deleting: row.op === "delete",
    }),
    await listPendingTaskIds(username),
  );
  const lists = readPendingWrites(rows, (row) => ({
    id: LIST_OPS.has(row.op) ? tasksOutboxTaskListId(row) : null,
    deleting: row.op === "listDelete",
  }));
  const deletingLists = new Set(
    [...lists].filter(([, write]) => write.deleting).map(([listId]) => listId),
  );
  return { tasks, lists: new Set(lists.keys()), deletingLists };
}

/**
 * A queued write is a conflict only when the server moved since it was queued.
 * Tasks compares against the first queued base, and an unknown base is not moved.
 */
function serverMovedSinceQueued(write: PendingTaskWrite, remote: Task): boolean {
  return serverMovedSince(write.bases.slice(0, 1), taskEtag(remote), "not-moved");
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
    if (serverMovedSinceQueued(write, task)) conflicts.push(task.id);
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
  const cachedTasks = await listCachedTasksForList(username, taskListId);
  for (const id of listRemovedIds(cachedTasks, remoteIds, (task) => writes.tasks.has(task.id))) {
    await removeTaskFromCache(username, id);
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
  const cachedTasks = (cached?.data.tasks ?? []).filter((task) => task.id);
  for (const id of listRemovedIds(cachedTasks, remoteTaskIds, (task) =>
    writes.tasks.has(task.id),
  )) {
    await removeTaskFromCache(username, id);
  }
  const cachedLists = (cached?.data.taskLists ?? []).filter((list) => list.id);
  for (const id of listRemovedIds(cachedLists, remoteListIds, (list) =>
    writes.lists.has(list.id),
  )) {
    await removeTaskListFromCache(username, id);
  }
  report(conflicts);
}
