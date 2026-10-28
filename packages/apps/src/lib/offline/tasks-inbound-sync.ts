import {
  fetchTasksLiveBootstrap,
  isTasksCannotCalculateChanges,
  listTaskListChanges,
  listTaskLists,
  listTasks,
} from "@/lib/api/wgw/tasks";
import { withOutboxLock, withOutboxLockIfFree } from "@/lib/offline/core/connectivity-sync-runner";
import { isCrossTabLockTimeout } from "@/lib/offline/core/cross-tab-lock";
import { TASKS_DOMAIN } from "@/lib/offline/tasks/tasks-schema";
import {
  ingestRemoteTaskList,
  ingestRemoteTaskListDestroyed,
  readTasksPendingWrites,
  reconcileTaskListResync,
  reconcileTasksSnapshot,
} from "@/lib/offline/tasks-inbound";
import { readTasksChangesState, writeTasksChangesState } from "@/lib/offline/tasks-offline-store";

/** Same cadence as the Contacts inbound poll. */
export const TASKS_INBOUND_POLL_MS = 10_000;

/** How long a reconnect pull waits for a flush that another tab is running. */
const RECONNECT_LOCK_WAIT_MS = 30_000;

export type TasksInboundSyncResult = {
  changed: boolean;
  usedFullResync: boolean;
};

/**
 * Full snapshot after `cannotCalculateChanges` (or with no stored state):
 * the existing bootstrap load, reconciled so queued local writes survive.
 */
async function fullResync(username: string): Promise<TasksInboundSyncResult> {
  // Taken before the snapshot: a change in between shows up again next pull.
  const { newState } = await listTaskListChanges(null);
  const snapshot = await fetchTasksLiveBootstrap();
  await reconcileTasksSnapshot(username, snapshot.data.taskLists, snapshot.data.tasks);
  await writeTasksChangesState(username, newState);
  return { changed: true, usedFullResync: true };
}

async function pull(username: string): Promise<TasksInboundSyncResult> {
  const since = await readTasksChangesState(username);
  if (since === null) return fullResync(username);

  let delta;
  try {
    delta = await listTaskListChanges(since);
  } catch (error) {
    if (!isTasksCannotCalculateChanges(error)) throw error;
    return fullResync(username);
  }

  const touched = [...new Set([...delta.created, ...delta.updated])];
  if (touched.length === 0 && delta.destroyed.length === 0) {
    if (delta.newState !== since) await writeTasksChangesState(username, delta.newState);
    return { changed: false, usedFullResync: false };
  }

  // Fetch everything first, so a failed request leaves the cache as it is.
  const remoteLists = touched.length > 0 ? await listTaskLists() : [];
  const listsById = new Map(remoteLists.map((list) => [list.id, list]));
  // A list gone between the two requests is reported destroyed next pull.
  const relisted = await Promise.all(
    touched
      .filter((id) => listsById.has(id))
      .map(async (taskListId) => ({ taskListId, tasks: await listTasks({ taskListId }) })),
  );

  for (const { taskListId, tasks } of relisted) {
    const pending = await readTasksPendingWrites(username);
    await ingestRemoteTaskList(username, listsById.get(taskListId)!, pending);
    await reconcileTaskListResync(username, taskListId, tasks, pending);
  }
  for (const taskListId of delta.destroyed) {
    await ingestRemoteTaskListDestroyed(username, taskListId);
  }
  await writeTasksChangesState(username, delta.newState);
  return { changed: true, usedFullResync: false };
}

/**
 * Pull server changes into the Tasks cache: `GET tasks/tasklists/changes`
 * since the stored state, then re-list and reconcile each created or updated
 * list and drop destroyed ones. Runs under the outbox lock so it never races a
 * flush. Returns undefined when the lock was busy (`waitForLock` false) or did
 * not come free in time; throws when a request fails (the cache is untouched).
 */
export async function syncTasksInbound(
  username: string,
  opts?: { waitForLock?: boolean },
): Promise<TasksInboundSyncResult | undefined> {
  if (!username) return undefined;
  if (!opts?.waitForLock) {
    return withOutboxLockIfFree(TASKS_DOMAIN, username, () => pull(username));
  }
  try {
    return await withOutboxLock(TASKS_DOMAIN, username, () => pull(username), {
      maxWaitMs: RECONNECT_LOCK_WAIT_MS,
    });
  } catch (error) {
    if (isCrossTabLockTimeout(error)) return undefined;
    throw error;
  }
}
