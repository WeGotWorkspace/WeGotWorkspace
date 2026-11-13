import { useCallback } from "react";
import { notifyTasksBootstrapUpdated } from "@/lib/offline/tasks/tasks-bootstrap-sync";
import { getTasksSyncRunner } from "@/lib/offline/tasks/tasks-hybrid-operations";
import { listFailedTaskOutbox } from "@/lib/offline/tasks/tasks-offline-store";
import { useFailedOutboxCount } from "@/lib/offline/core/use-failed-outbox-count";
import type { ActionNotice } from "@/notice-bar/src/notice-bar";
import { useSyncRetryNotice } from "@/notice-bar/src/use-sync-retry-notice";
import type { TasksUILabels } from "@/tasks-core/src/tasks-labels";

type UseTasksSyncNoticeArgs = {
  username: string | null;
  labels: TasksUILabels;
  reloadFromCache: () => Promise<void>;
};

/**
 * The notice bar row while queued task changes fail to sync (#1894). Retry
 * flushes the outbox again, then rereads the cache for this and other tabs.
 * Refused task writes (403/404) are parked for the rescue notice instead, so
 * they leave the outbox and do not count here. A refused list write stays
 * queued as a permanent failure and counts.
 */
export function useTasksSyncNotice({
  username,
  labels: L,
  reloadFromCache,
}: UseTasksSyncNoticeArgs): ActionNotice | null {
  const { count, refresh } = useFailedOutboxCount(username, listFailedTaskOutbox);

  const retry = useCallback(async () => {
    if (!username) return;
    try {
      await getTasksSyncRunner(username).flush();
    } finally {
      await reloadFromCache().catch(() => undefined);
      notifyTasksBootstrapUpdated(username);
      await refresh();
    }
  }, [refresh, reloadFromCache, username]);

  return useSyncRetryNotice({
    id: "sync:tasks",
    active: count > 0,
    title: L.syncFailedNotice,
    retryLabel: L.retrySync,
    onRetry: retry,
  });
}
