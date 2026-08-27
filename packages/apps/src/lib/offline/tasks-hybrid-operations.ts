import type {
  Task,
  TaskCreate,
  TaskList,
  TaskListCreate,
  TaskListPatch,
  TaskPatch,
  TasksAPIOperations,
  TasksMutationOpts,
} from "@/tasks-core/src/tasks-types";
import { mergeShareWith } from "@/share-ui/collection-share";
import {
  createTask,
  createTaskList,
  deleteTask,
  deleteTaskList,
  fetchTasksLiveBootstrap,
  getTask,
  patchTask,
  patchTaskList,
  putTask,
} from "@/lib/api/wgw/tasks";
import { searchCollectionSharePrincipals } from "@/lib/api/wgw/calendar";
import { isFetchNetworkError, readBrowserOnline } from "@/lib/offline/core/browser-online";
import {
  applyTaskPatch,
  taskCreateFromTask,
  taskEtag,
} from "@/lib/offline/tasks/tasks-patch-merge";
import {
  createTempTaskId,
  createTempTaskListId,
  enqueueCoalescedTaskUpdate,
  enqueueOutboxMutation,
  readTasksBootstrapFromCache,
  removeTaskFromCache,
  removeTaskListFromCache,
  upsertTaskInCache,
  upsertTaskListInCache,
  writeTasksBootstrapToCache,
} from "@/lib/offline/tasks-offline-store";
import { TASKS_DOMAIN } from "@/lib/offline/tasks/tasks-schema";
import { flushTasksOutbox, type OutboxFlushResult } from "@/lib/offline/tasks-outbox-flush";
import { reportTasksSyncConflicts } from "@/lib/offline/tasks-sync-conflicts";
import { readOfflineTasksUsername } from "@/lib/offline/offline-session";
import {
  ConnectivitySyncRunner,
  ConnectivitySyncRunnerRegistry,
} from "@/lib/offline/core/connectivity-sync-runner";

function concurrencyEtag(task: Task, opts?: TasksMutationOpts): string | undefined {
  return opts?.ifMatch ?? taskEtag(task);
}

function rethrowUnlessOfflineQueue(error: unknown, opts?: TasksMutationOpts): void {
  if (opts?.signal?.aborted) throw error;
  if (error instanceof DOMException && error.name === "AbortError") throw error;
  if (!isFetchNetworkError(error)) throw error;
}

const syncRunnerRegistry = new ConnectivitySyncRunnerRegistry<OutboxFlushResult>();

async function flushTasksOutboxAndReport(username: string): Promise<OutboxFlushResult> {
  const result = await flushTasksOutbox(username);
  reportTasksSyncConflicts(result.etagMismatches);
  return result;
}

function runnerFor(username: string): ConnectivitySyncRunner<OutboxFlushResult> {
  return syncRunnerRegistry.getOrCreate(username, async () => flushTasksOutboxAndReport(username));
}

async function resolveCachedTask(
  username: string,
  taskId: string,
  opts?: TasksMutationOpts,
): Promise<Task | undefined> {
  const cached = await readTasksBootstrapFromCache(username);
  const fromCache = cached?.data.tasks.find((task) => task.id === taskId);
  if (fromCache || !readBrowserOnline()) return fromCache;

  try {
    return await getTask(taskId, opts);
  } catch (error) {
    if (isFetchNetworkError(error)) return fromCache;
    throw error;
  }
}

async function queueOfflineCreate(username: string, body: TaskCreate): Promise<Task> {
  const tempId = createTempTaskId();
  const listId = Object.keys(body.taskListIds).find((id) => body.taskListIds[id]) ?? "default";
  const optimistic: Task = {
    "@type": "Task",
    id: tempId,
    taskListId: listId,
    uid: body.uid ?? `urn:uuid:${crypto.randomUUID()}`,
    title: body.title,
    description: body.description ?? null,
    due: body.due ?? null,
    workflowStatus: body.workflowStatus ?? "needs-action",
    priority: body.priority ?? null,
    isDraft: false,
    sortOrder: Number.MAX_SAFE_INTEGER,
    categories: body.categories ?? [],
    alerts: body.alerts,
    etag: `local-etag-${tempId}`,
  };
  await upsertTaskInCache(username, optimistic, true);
  await enqueueOutboxMutation(username, {
    id: crypto.randomUUID(),
    domain: TASKS_DOMAIN,
    op: "create",
    payload: JSON.stringify({
      creationId: tempId,
      tempTaskId: tempId,
      body,
    }),
  });
  return optimistic;
}

async function queueOfflinePatch(
  username: string,
  taskId: string,
  patch: TaskPatch,
  existing: Task,
  opts?: TasksMutationOpts,
): Promise<Task> {
  const etag = concurrencyEtag(existing, opts);
  const optimistic = applyTaskPatch(existing, patch);
  await upsertTaskInCache(username, optimistic, true);
  await enqueueCoalescedTaskUpdate(username, taskId, patch, etag);
  return optimistic;
}

async function queueOfflineMove(
  username: string,
  taskId: string,
  taskListId: string,
  existing: Task,
  opts?: TasksMutationOpts,
): Promise<Task> {
  const etag = concurrencyEtag(existing, opts);
  const optimistic = { ...existing, taskListId };
  await upsertTaskInCache(username, optimistic, true);
  await enqueueOutboxMutation(username, {
    id: crypto.randomUUID(),
    domain: TASKS_DOMAIN,
    op: "move",
    payload: JSON.stringify({ taskId, taskListId }),
    ifInState: etag,
  });
  return optimistic;
}

async function queueOfflineDelete(
  username: string,
  taskId: string,
  etag: string | undefined,
): Promise<void> {
  await removeTaskFromCache(username, taskId);
  await enqueueOutboxMutation(username, {
    id: crypto.randomUUID(),
    domain: TASKS_DOMAIN,
    op: "delete",
    payload: JSON.stringify({ taskId }),
    ifInState: etag,
  });
}

async function queueOfflineListCreate(username: string, body: TaskListCreate): Promise<TaskList> {
  const tempId = createTempTaskListId();
  const optimistic: TaskList = {
    id: tempId,
    name: body.name,
    color: body.color ?? null,
    scope: body.groupSlug ? "group" : "personal",
    groupSlug: body.groupSlug ?? null,
    sortOrder: Number.MAX_SAFE_INTEGER,
    isDefault: false,
    isSubscribed: true,
    myRights: {
      mayReadItems: true,
      mayWriteAll: true,
      mayWriteOwn: true,
      mayUpdatePrivate: true,
      mayRSVP: true,
      mayAdmin: true,
      mayDelete: true,
      mayShare: true,
    },
  };
  await upsertTaskListInCache(username, optimistic);
  await enqueueOutboxMutation(username, {
    id: crypto.randomUUID(),
    domain: TASKS_DOMAIN,
    op: "listCreate",
    payload: JSON.stringify({
      creationId: tempId,
      tempListId: tempId,
      body,
    }),
  });
  return optimistic;
}

async function queueOfflineListPatch(
  username: string,
  taskListId: string,
  patch: TaskListPatch,
  existing: TaskList,
): Promise<TaskList> {
  const { shareWith, ...rest } = patch;
  const optimistic: TaskList = {
    ...existing,
    ...rest,
    ...(shareWith !== undefined
      ? { shareWith: mergeShareWith(existing.shareWith, shareWith ?? {}) as TaskList["shareWith"] }
      : {}),
  };
  await upsertTaskListInCache(username, optimistic);
  await enqueueOutboxMutation(username, {
    id: crypto.randomUUID(),
    domain: TASKS_DOMAIN,
    op: "listUpdate",
    payload: JSON.stringify({ taskListId, patch }),
  });
  return optimistic;
}

async function queueOfflineListDelete(
  username: string,
  taskListId: string,
  onDestroyRemoveContents?: boolean,
): Promise<void> {
  await removeTaskListFromCache(username, taskListId);
  if (onDestroyRemoveContents) {
    const cached = await readTasksBootstrapFromCache(username);
    if (cached) {
      for (const task of cached.data.tasks.filter((entry) => entry.taskListId === taskListId)) {
        await removeTaskFromCache(username, task.id);
      }
    }
  }
  await enqueueOutboxMutation(username, {
    id: crypto.randomUUID(),
    domain: TASKS_DOMAIN,
    op: "listDelete",
    payload: JSON.stringify({ taskListId, onDestroyRemoveContents: !!onDestroyRemoveContents }),
  });
}

export function createHybridTasksOperations(username: string): TasksAPIOperations {
  const runner = runnerFor(username);

  return {
    createTask: async (body, opts) => {
      if (!readBrowserOnline()) {
        return queueOfflineCreate(username, body);
      }
      try {
        const task = await createTask(body, opts);
        await upsertTaskInCache(username, task, false);
        await runner.flush();
        return task;
      } catch (error) {
        rethrowUnlessOfflineQueue(error, opts);
        return queueOfflineCreate(username, body);
      }
    },
    patchTask: async (taskId, patch, opts) => {
      const existing = await resolveCachedTask(username, taskId, opts);
      if (!existing) {
        throw new Error(
          !readBrowserOnline() ? "Task not found in cache while offline" : "Task not found",
        );
      }
      if (!readBrowserOnline()) {
        return queueOfflinePatch(username, taskId, patch, existing, opts);
      }
      const etag = concurrencyEtag(existing, opts);
      try {
        const task = await patchTask(taskId, patch, { ...opts, ifMatch: etag });
        await upsertTaskInCache(username, task, false);
        await runner.flush();
        return task;
      } catch (error) {
        rethrowUnlessOfflineQueue(error, opts);
        return queueOfflinePatch(username, taskId, patch, existing, opts);
      }
    },
    deleteTask: async (taskId, opts) => {
      const cached = await readTasksBootstrapFromCache(username);
      const existing = cached?.data.tasks.find((task) => task.id === taskId);
      const etag = existing ? concurrencyEtag(existing, opts) : opts?.ifMatch;
      if (!readBrowserOnline()) {
        await queueOfflineDelete(username, taskId, etag);
        return;
      }
      try {
        await deleteTask(taskId, { ...opts, ifMatch: etag });
        await removeTaskFromCache(username, taskId);
        await runner.flush();
      } catch (error) {
        rethrowUnlessOfflineQueue(error, opts);
        await queueOfflineDelete(username, taskId, etag);
      }
    },
    moveTaskToList: async (taskId, taskListId, opts) => {
      const existing = await resolveCachedTask(username, taskId, opts);
      if (!existing) {
        throw new Error(
          !readBrowserOnline() ? "Task not found in cache while offline" : "Task not found",
        );
      }
      if (!readBrowserOnline()) {
        return queueOfflineMove(username, taskId, taskListId, existing, opts);
      }
      const etag = concurrencyEtag(existing, opts);
      try {
        const task = await putTask(taskId, taskCreateFromTask(existing, taskListId), {
          ...opts,
          ifMatch: etag,
        });
        await upsertTaskInCache(username, task, false);
        await runner.flush();
        return task;
      } catch (error) {
        rethrowUnlessOfflineQueue(error, opts);
        return queueOfflineMove(username, taskId, taskListId, existing, opts);
      }
    },
    createTaskList: async (body, opts) => {
      if (!readBrowserOnline()) {
        return queueOfflineListCreate(username, body);
      }
      try {
        const list = await createTaskList(body, opts);
        await upsertTaskListInCache(username, list);
        await runner.flush();
        return list;
      } catch (error) {
        rethrowUnlessOfflineQueue(error, opts);
        return queueOfflineListCreate(username, body);
      }
    },
    patchTaskList: async (taskListId, patch, opts) => {
      const isShareMutation = patch.shareWith !== undefined;
      const isOwnerTransfer = patch.groupSlug !== undefined;
      const cached = await readTasksBootstrapFromCache(username);
      const existing = cached?.data.taskLists.find((list) => list.id === taskListId);
      if (!existing) {
        throw new Error(
          !readBrowserOnline()
            ? "Task list not found in cache while offline"
            : "Task list not found",
        );
      }
      const queueOffline = async () => {
        if (isShareMutation) {
          throw new Error("Sharing changes require a connection.");
        }
        if (isOwnerTransfer) {
          throw new Error("Owner changes require a connection.");
        }
        return queueOfflineListPatch(username, taskListId, patch, existing);
      };
      if (!readBrowserOnline()) {
        return queueOffline();
      }
      try {
        const list = await patchTaskList(taskListId, patch, opts);
        await upsertTaskListInCache(username, list);
        await runner.flush();
        return list;
      } catch (error) {
        if (isShareMutation || isOwnerTransfer) throw error;
        rethrowUnlessOfflineQueue(error, opts);
        return queueOffline();
      }
    },
    searchSharePrincipals: (query) => searchCollectionSharePrincipals(query, username),
    deleteTaskList: async (taskListId, opts) => {
      if (!readBrowserOnline()) {
        await queueOfflineListDelete(username, taskListId, opts?.onDestroyRemoveContents);
        return;
      }
      try {
        await deleteTaskList(taskListId, opts);
        await removeTaskListFromCache(username, taskListId);
        if (opts?.onDestroyRemoveContents) {
          const cached = await readTasksBootstrapFromCache(username);
          if (cached) {
            for (const task of cached.data.tasks.filter(
              (entry) => entry.taskListId === taskListId,
            )) {
              await removeTaskFromCache(username, task.id);
            }
          }
        }
        await runner.flush();
      } catch (error) {
        rethrowUnlessOfflineQueue(error, opts);
        await queueOfflineListDelete(username, taskListId, opts?.onDestroyRemoveContents);
      }
    },
  };
}

export async function fetchTasksHybridBootstrap(): Promise<
  Awaited<ReturnType<typeof fetchTasksLiveBootstrap>>
> {
  const bootstrap = await fetchTasksLiveBootstrap();
  const username = bootstrap.session.user.username;
  if (!username) {
    throw new Error("Tasks bootstrap missing username");
  }
  if (readBrowserOnline()) {
    await flushTasksOutboxAndReport(username);
  }
  await writeTasksBootstrapToCache(username, bootstrap);
  return bootstrap;
}

export async function loadTasksBootstrapHybrid(): Promise<
  Awaited<ReturnType<typeof fetchTasksLiveBootstrap>>
> {
  if (!readBrowserOnline()) {
    const username = readOfflineTasksUsername();
    if (username) {
      const cached = await readTasksBootstrapFromCache(username);
      if (cached) return cached;
    }
    throw new Error("No cached tasks available offline");
  }

  return fetchTasksHybridBootstrap();
}

export function getTasksSyncRunner(username: string): ConnectivitySyncRunner<OutboxFlushResult> {
  return runnerFor(username);
}
