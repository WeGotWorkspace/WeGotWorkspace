import type { TasksAppBootstrap } from "@/lib/api/mock/tasks-bootstrap";
import { rememberOfflineTasksUsername } from "@/lib/offline/offline-session";
import type { Task, TaskList, TaskPatch } from "@/tasks-core/src/tasks-types";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import {
  isSyncNoticeOutboxRow,
  listOutboxMutationsForDomain,
} from "@/lib/offline/core/outbox-store";
import { enqueueCoalescedOutboxUpdate } from "@/lib/offline/core/outbox-coalescing";
import type { OfflineOutboxRow } from "@/lib/offline/core/types";
import {
  TASKS_DOMAIN,
  tasksItemsTable,
  tasksListsTable,
  type OfflineTaskRow,
} from "@/lib/offline/tasks/tasks-schema";
import { coalesceTaskPatches } from "@/lib/offline/tasks/tasks-patch-merge";

export {
  enqueueOutboxMutation,
  listOutboxMutations,
  markOutboxError,
  removeOutboxMutation,
} from "@/lib/offline/core/outbox-store";

const META_SESSION = "tasks:session";
const META_GROUPS = "tasks:groups";

function taskRow(task: Task, pendingSync: boolean): OfflineTaskRow {
  return {
    id: task.id,
    taskListId: task.taskListId,
    data: JSON.stringify(task),
    pendingSync,
    updatedAt: Date.now(),
  };
}

export async function readTasksBootstrapFromCache(
  username: string,
): Promise<TasksAppBootstrap | null> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const sessionRow = await db.meta.get(META_SESSION);
  if (!sessionRow?.value) return null;

  const lists = await tasksListsTable(db).toArray();
  const items = await tasksItemsTable(db).toArray();
  if (lists.length === 0 && items.length === 0) return null;

  const session = JSON.parse(sessionRow.value) as TasksAppBootstrap["session"];
  const taskLists = lists.map((row) => JSON.parse(row.data) as TaskList);
  const tasks = items.map((row) => JSON.parse(row.data) as Task);
  const groupsRow = await db.meta.get(META_GROUPS);
  const groups = groupsRow?.value
    ? (JSON.parse(groupsRow.value) as TasksAppBootstrap["data"]["groups"])
    : undefined;

  return {
    session,
    data: { taskLists, tasks, groups },
  };
}

export async function writeTasksBootstrapToCache(
  username: string,
  bootstrap: TasksAppBootstrap,
): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const items = tasksItemsTable(db);
  const lists = tasksListsTable(db);
  const pendingRows = await items.filter((row) => row.pendingSync).toArray();
  await db.meta.put({ key: META_SESSION, value: JSON.stringify(bootstrap.session) });
  if (bootstrap.data.groups) {
    await db.meta.put({ key: META_GROUPS, value: JSON.stringify(bootstrap.data.groups) });
  } else {
    await db.meta.delete(META_GROUPS);
  }
  rememberOfflineTasksUsername(username);
  await lists.clear();
  await lists.bulkPut(
    bootstrap.data.taskLists.map((list) => ({
      id: list.id,
      data: JSON.stringify(list),
    })),
  );
  await items.clear();
  await items.bulkPut(bootstrap.data.tasks.map((task) => taskRow(task, false)));
  if (pendingRows.length > 0) {
    await items.bulkPut(pendingRows);
  }
}

export async function upsertTaskInCache(
  username: string,
  task: Task,
  pendingSync = false,
): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  await tasksItemsTable(db).put(taskRow(task, pendingSync));
}

export async function removeTaskFromCache(username: string, taskId: string): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  await tasksItemsTable(db).delete(taskId);
}

export async function upsertTaskListInCache(username: string, list: TaskList): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  await tasksListsTable(db).put({
    id: list.id,
    data: JSON.stringify(list),
  });
}

export async function removeTaskListFromCache(username: string, listId: string): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  await tasksListsTable(db).delete(listId);
}

export async function listFailedTaskOutbox(username: string): Promise<OfflineOutboxRow[]> {
  const rows = await listOutboxMutationsForDomain(username, TASKS_DOMAIN);
  return rows.filter(isSyncNoticeOutboxRow);
}

export async function listPendingTaskIds(username: string): Promise<string[]> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const rows = await tasksItemsTable(db)
    .filter((row) => row.pendingSync)
    .toArray();
  return rows.map((row) => row.id);
}

export function tasksOutboxTaskId(row: OfflineOutboxRow): string | null {
  if (row.domain !== TASKS_DOMAIN) return null;
  try {
    const payload = JSON.parse(row.payload) as {
      taskId?: string;
      tempTaskId?: string;
      creationId?: string;
    };
    return payload.taskId ?? payload.tempTaskId ?? payload.creationId ?? null;
  } catch {
    return null;
  }
}

export function tasksOutboxTaskListId(row: OfflineOutboxRow): string | null {
  if (row.domain !== TASKS_DOMAIN) return null;
  try {
    const payload = JSON.parse(row.payload) as {
      taskListId?: string;
      tempListId?: string;
      creationId?: string;
    };
    return payload.taskListId ?? payload.tempListId ?? payload.creationId ?? null;
  } catch {
    return null;
  }
}

export async function enqueueCoalescedTaskUpdate(
  username: string,
  taskId: string,
  patch: TaskPatch,
  ifInState: string | undefined,
): Promise<void> {
  await enqueueCoalescedOutboxUpdate({
    username,
    domain: TASKS_DOMAIN,
    entityId: taskId,
    patch,
    ifInState,
    mergePatches: coalesceTaskPatches,
    entityIdFromRow: tasksOutboxTaskId,
    buildUpdatePayload: (entityId, mergedPatch) => ({ taskId: entityId, patch: mergedPatch }),
    readPatchFromPayload: (payload) => payload.patch as TaskPatch,
  });
}

export function createTempTaskId(): string {
  return `local-${crypto.randomUUID().replace(/-/g, "")}`;
}

export function createTempTaskListId(): string {
  return `local-list-${crypto.randomUUID().replace(/-/g, "")}`;
}
