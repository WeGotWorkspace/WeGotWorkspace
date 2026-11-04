import { CloudOff } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { notifyTasksBootstrapUpdated } from "@/lib/offline/tasks/tasks-bootstrap-sync";
import { getTasksSyncRunner } from "@/lib/offline/tasks/tasks-hybrid-operations";
import { listFailedTaskOutbox } from "@/lib/offline/tasks/tasks-offline-store";
import { useFailedOutboxCount } from "@/lib/offline/use-failed-outbox-count";
import type { Notice } from "@/notice-bar/src/notice-bar";
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
}: UseTasksSyncNoticeArgs): Notice | null {
  const { count, refresh } = useFailedOutboxCount(username, listFailedTaskOutbox);
  const [retrying, setRetrying] = useState(false);

  const retry = useCallback(() => {
    if (!username) return;
    setRetrying(true);
    void getTasksSyncRunner(username)
      .flush()
      .catch(() => undefined)
      .finally(async () => {
        try {
          await reloadFromCache().catch(() => undefined);
          notifyTasksBootstrapUpdated(username);
          await refresh();
        } finally {
          setRetrying(false);
        }
      });
  }, [refresh, reloadFromCache, username]);

  return useMemo(
    () => (count === 0 ? null : tasksSyncNotice(L, retry, retrying)),
    [L, count, retry, retrying],
  );
}

/** The Tasks stuck-sync row of the notice bar. */
export function tasksSyncNotice(L: TasksUILabels, onRetry: () => void, retrying = false): Notice {
  return {
    id: "sync:tasks",
    tone: "error",
    icon: <CloudOff className="callout__icon" aria-hidden />,
    title: L.syncFailedNotice,
    actionLabel: L.retrySync,
    onAction: onRetry,
    actionDisabled: retrying,
  };
}
