import { isMfaSetupRequiredError } from "@/lib/api/wgw/mfa-error";
import type { TasksAppBootstrap } from "@/lib/api/mock/tasks-bootstrap";
import type {
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
import { TASKS_DOMAIN } from "@/lib/offline/tasks/tasks-schema";
import {
  listOutboxMutations,
  markOutboxError,
  readTasksBootstrapFromCache,
  removeOutboxMutation,
  removeTaskFromCache,
  removeTaskListFromCache,
  upsertTaskInCache,
  upsertTaskListInCache,
  writeTasksBootstrapToCache,
} from "@/lib/offline/tasks-offline-store";
import { taskCreateFromTask } from "@/lib/offline/tasks/tasks-patch-merge";

export type OutboxFlushResult = {
  etagMismatches: string[];
  bootstrap: TasksAppBootstrap | null;
};

function isEtagMismatch(error: unknown): boolean {
  return error instanceof TasksRequestError && error.status === 412;
}

export async function flushTasksOutbox(username: string): Promise<OutboxFlushResult> {
  const cached = await readTasksBootstrapFromCache(username);
  if (!cached) {
    return { etagMismatches: [], bootstrap: null };
  }

  const rows = await listOutboxMutations(username);
  const etagMismatches: string[] = [];

  for (const row of rows) {
    if (row.domain !== TASKS_DOMAIN) continue;
    try {
      const payload = JSON.parse(row.payload) as Record<string, unknown>;
      if (row.op === "create") {
        const body = payload.body as TaskCreate;
        const tempId = String(payload.tempTaskId ?? "");
        const task = await createTask(body);
        if (tempId) await removeTaskFromCache(username, tempId);
        await upsertTaskInCache(username, task, false);
      } else if (row.op === "update") {
        const taskId = String(payload.taskId ?? "");
        const patch = payload.patch as TaskPatch;
        const task = await patchTask(taskId, patch, { ifMatch: row.ifInState });
        await upsertTaskInCache(username, task, false);
      } else if (row.op === "move") {
        const taskId = String(payload.taskId ?? "");
        const taskListId = String(payload.taskListId ?? "");
        const localTask = cached.data.tasks.find((task) => task.id === taskId);
        if (!localTask) {
          throw new Error(`Task ${taskId} missing from cache for move flush`);
        }
        const task = await putTask(taskId, taskCreateFromTask(localTask, taskListId), {
          ifMatch: row.ifInState,
        });
        await upsertTaskInCache(username, task, false);
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
      if (isMfaSetupRequiredError(error)) break;
      if (isEtagMismatch(error)) {
        const taskId = String(JSON.parse(row.payload).taskId ?? "");
        if (taskId) etagMismatches.push(taskId);
        await markOutboxError(username, row.id, "etagMismatch");
        continue;
      }
      await markOutboxError(
        username,
        row.id,
        error instanceof Error ? error.message : String(error),
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
