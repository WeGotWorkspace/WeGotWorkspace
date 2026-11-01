import type { TasksAppBootstrap } from "@/lib/api/mock/tasks-bootstrap";
import type {
  Task,
  TaskCreate,
  TaskListCreate,
  TaskListPatch,
  TaskPatch,
} from "@/tasks-core/src/tasks-types";
import {
  createTask,
  createTaskList,
  deleteTask,
  deleteTaskList,
  patchTask,
  patchTaskList,
  putTask,
  TasksRequestError,
} from "@/lib/api/wgw/tasks";
import { httpStatusFromFlushError } from "@/lib/offline/core/outbox-error-status";
import {
  getOutboxMutation,
  rebaseQueuedEntityRows,
  sendChangedRowAgain,
  settleSentOutboxMutation,
} from "@/lib/offline/core/outbox-store";
import type { OfflineOutboxRow } from "@/lib/offline/core/types";
import { TASKS_DOMAIN, tasksItemsTable } from "@/lib/offline/tasks/tasks-schema";
import {
  getTaskFromCache,
  listOutboxMutations,
  markOutboxError,
  readTasksBootstrapFromCache,
  removeOutboxMutation,
  removeTaskFromCache,
  removeTaskListFromCache,
  tasksOutboxTaskId,
  upsertTaskInCache,
  upsertTaskListInCache,
  writeTasksBootstrapToCache,
} from "@/lib/offline/tasks-offline-store";
import { taskCreateFromTask, taskEtag } from "@/lib/offline/tasks/tasks-patch-merge";

export type OutboxFlushResult = {
  etagMismatches: string[];
  bootstrap: TasksAppBootstrap | null;
};

function isEtagMismatch(error: unknown): boolean {
  return error instanceof TasksRequestError && error.status === 412;
}

/** A queued row for the task, pointed at the server's id and version of it. */
function rowFollowingTask(row: OfflineOutboxRow, task: Task): OfflineOutboxRow {
  const payload = JSON.parse(row.payload) as Record<string, unknown>;
  const next = typeof payload.taskId === "string" ? { ...payload, taskId: task.id } : payload;
  return { ...row, payload: JSON.stringify(next), ifInState: taskEtag(task) };
}

/**
 * A write for `localId` landed as `task`. The task's other queued writes now
 * start from that answer (its id and etag), so they are not sent to a
 * temporary id or refused as a conflict with this write. The cache takes the
 * answer only when nothing else is owed; otherwise it keeps the local copy,
 * under the server id and etag, until the last write lands.
 */
async function followLandedTaskWrite(
  username: string,
  sentRowId: string,
  localId: string,
  task: Task,
  stillQueued = false,
): Promise<void> {
  const rebased = await rebaseQueuedEntityRows(username, {
    domain: TASKS_DOMAIN,
    entityId: localId,
    sentRowId,
    entityIdFromRow: tasksOutboxTaskId,
    rebase: (row) => rowFollowingTask(row, task),
  });
  if (stillQueued) return;
  const local = rebased > 0 ? await getTaskFromCache(username, localId) : null;
  if (localId !== task.id) await removeTaskFromCache(username, localId);
  if (local) {
    await upsertTaskInCache(
      username,
      { ...local, id: task.id, uid: task.uid, etag: taskEtag(task) } as Task,
      true,
    );
  } else {
    await upsertTaskInCache(username, task, false);
  }
}

export async function flushTasksOutbox(username: string): Promise<OutboxFlushResult> {
  const cached = await readTasksBootstrapFromCache(username);
  if (!cached) {
    return { etagMismatches: [], bootstrap: null };
  }

  const rows = await listOutboxMutations(username);
  const etagMismatches: string[] = [];
  // Rows sent again in this flush (`sendChangedRowAgain` appends to `rows`).
  const resends = new Map<string, number>();

  // Tasks with a write that failed in this flush: their later writes wait, so
  // they are not sent from a version or to an id that write never produced.
  const held = new Set<string>();

  for (const listed of rows) {
    if (listed.domain !== TASKS_DOMAIN) continue;
    // Re-read: an earlier row of the same task may have rebased this one.
    const row = await getOutboxMutation(username, listed.id);
    if (!row) continue;
    const entityId = tasksOutboxTaskId(row);
    if (entityId && held.has(entityId)) continue;
    try {
      const payload = JSON.parse(row.payload) as Record<string, unknown>;
      if (row.op === "create") {
        const body = payload.body as TaskCreate;
        const tempId = String(payload.tempTaskId ?? "");
        const task = await createTask(body);
        await followLandedTaskWrite(username, row.id, tempId || task.id, task);
      } else if (row.op === "update") {
        const taskId = String(payload.taskId ?? "");
        const patch = payload.patch as TaskPatch;
        const task = await patchTask(taskId, patch, { ifMatch: row.ifInState });
        // A patch merged in while this one was sent is owed on top of `task`.
        const settlement = await settleSentOutboxMutation(username, row, {
          rebase: (current) => rowFollowingTask(current, task),
          cacheTables: (db) => [tasksItemsTable(db)],
          onRemoved: () => followLandedTaskWrite(username, row.id, taskId, task),
          onChanged: () => followLandedTaskWrite(username, row.id, taskId, task, true),
        });
        sendChangedRowAgain(rows, resends, settlement);
        continue;
      } else if (row.op === "move") {
        const taskId = String(payload.taskId ?? "");
        const taskListId = String(payload.taskListId ?? "");
        const localTask = await getTaskFromCache(username, taskId);
        if (!localTask) {
          throw new Error(`Task ${taskId} missing from cache for move flush`);
        }
        const task = await putTask(taskId, taskCreateFromTask(localTask, taskListId), {
          ifMatch: row.ifInState,
        });
        await followLandedTaskWrite(username, row.id, taskId, task);
      } else if (row.op === "delete") {
        const taskId = String(payload.taskId ?? "");
        await deleteTask(taskId, { ifMatch: row.ifInState });
        await removeTaskFromCache(username, taskId);
      } else if (row.op === "listCreate") {
        const body = payload.body as TaskListCreate;
        const tempId = String(payload.tempListId ?? "");
        const list = await createTaskList(body);
        if (tempId) await removeTaskListFromCache(username, tempId);
        await upsertTaskListInCache(username, list);
      } else if (row.op === "listUpdate") {
        const taskListId = String(payload.taskListId ?? "");
        const patch = payload.patch as TaskListPatch;
        const list = await patchTaskList(taskListId, patch);
        await upsertTaskListInCache(username, list);
      } else if (row.op === "listDelete") {
        const taskListId = String(payload.taskListId ?? "");
        const onDestroyRemoveContents = payload.onDestroyRemoveContents === true;
        await deleteTaskList(taskListId, { onDestroyRemoveContents });
        await removeTaskListFromCache(username, taskListId);
        if (onDestroyRemoveContents) {
          const dbTasks = cached.data.tasks.filter((task) => task.taskListId !== taskListId);
          for (const task of dbTasks) {
            await removeTaskFromCache(username, task.id);
          }
        }
      }
      await removeOutboxMutation(username, row.id);
    } catch (error) {
      if (entityId) held.add(entityId);
      if (isEtagMismatch(error)) {
        const taskId = String(JSON.parse(row.payload).taskId ?? "");
        if (taskId) etagMismatches.push(taskId);
        await markOutboxError(username, row.id, "etagMismatch");
        continue;
      }
      const status = httpStatusFromFlushError(error);
      await markOutboxError(
        username,
        row.id,
        error instanceof Error ? error.message : String(error),
        status,
      );
    }
  }

  const nextBootstrap = await readTasksBootstrapFromCache(username);
  if (nextBootstrap) {
    nextBootstrap.session = cached.session;
    nextBootstrap.data.groups = cached.data.groups;
    await writeTasksBootstrapToCache(username, nextBootstrap);
  }

  return { etagMismatches, bootstrap: nextBootstrap };
}
