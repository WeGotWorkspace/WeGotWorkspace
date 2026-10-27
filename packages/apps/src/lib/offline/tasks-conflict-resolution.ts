import { getTask } from "@/lib/api/wgw/tasks";
import type { Task } from "@/tasks-core/src/tasks-types";
import { isFetchNetworkError } from "@/lib/offline/core/browser-online";
import { withOutboxLock } from "@/lib/offline/core/connectivity-sync-runner";
import { TASKS_DOMAIN } from "@/lib/offline/tasks/tasks-schema";
import {
  listOutboxMutations,
  putOutboxMutation,
  removeOutboxMutation,
} from "@/lib/offline/core/outbox-store";
import {
  buildResolvedTaskPatch,
  type TaskConflictFieldChoices,
} from "@/lib/offline/tasks-conflict-merge";
import {
  removeTaskFromCache,
  tasksOutboxTaskId,
  upsertTaskInCache,
} from "@/lib/offline/tasks-offline-store";
import { taskEtag } from "@/lib/offline/tasks/tasks-patch-merge";
import { flushTasksOutbox, type OutboxFlushResult } from "@/lib/offline/tasks-outbox-flush";

async function outboxRowsForTask(username: string, taskId: string) {
  const rows = await listOutboxMutations(username);
  return rows.filter((row) => tasksOutboxTaskId(row) === taskId);
}

export async function resolveTaskConflictKeepLocal(
  username: string,
  taskId: string,
): Promise<OutboxFlushResult> {
  const fresh = await getTask(taskId);
  const freshEtag = taskEtag(fresh);

  const rows = await outboxRowsForTask(username, taskId);
  for (const row of rows) {
    if (row.op !== "update" && row.op !== "delete" && row.op !== "move") continue;
    await putOutboxMutation(username, {
      ...row,
      ifInState: freshEtag,
      retries: 0,
      lastError: undefined,
    });
  }

  return withOutboxLock(TASKS_DOMAIN, username, () => flushTasksOutbox(username));
}

export async function resolveTaskConflictFieldMerge(
  username: string,
  taskId: string,
  localTask: Task,
  choices: TaskConflictFieldChoices,
): Promise<OutboxFlushResult> {
  const fresh = await getTask(taskId);
  const freshEtag = taskEtag(fresh);
  const mergedPatch = buildResolvedTaskPatch(fresh, localTask, choices);

  const rows = await outboxRowsForTask(username, taskId);
  if (Object.keys(mergedPatch).length === 0) {
    for (const row of rows) {
      await removeOutboxMutation(username, row.id);
    }
    await upsertTaskInCache(username, fresh, false);
    return { etagMismatches: [], bootstrap: null };
  }

  for (const row of rows) {
    if (row.op !== "update") continue;
    await putOutboxMutation(username, {
      ...row,
      payload: JSON.stringify({ taskId, patch: mergedPatch }),
      ifInState: freshEtag,
      retries: 0,
      lastError: undefined,
    });
  }

  return withOutboxLock(TASKS_DOMAIN, username, () => flushTasksOutbox(username));
}

export async function resolveTaskConflictUseServer(
  username: string,
  taskId: string,
): Promise<void> {
  const rows = await outboxRowsForTask(username, taskId);
  for (const row of rows) {
    await removeOutboxMutation(username, row.id);
  }

  try {
    const fresh = await getTask(taskId);
    await upsertTaskInCache(username, fresh, false);
  } catch (error) {
    if (isFetchNetworkError(error)) throw error;
    await removeTaskFromCache(username, taskId);
  }
}
