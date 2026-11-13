import { useCallback } from "react";
import { getMeetChatSyncRunner } from "@/lib/offline/meet-chat-hybrid-operations";
import { listFailedMeetChatOutbox } from "@/lib/offline/meet-chat-offline-store";
import { useFailedOutboxCount } from "@/lib/offline/core/use-failed-outbox-count";
import type { ActionNotice } from "@/notice-bar/src/notice-bar";
import { useSyncRetryNotice } from "@/notice-bar/src/use-sync-retry-notice";
import { meetLabels } from "@/meet-core/src/meet-labels";

type UseMeetChatSyncNoticeArgs = {
  username: string | null;
  /** Rereads channels and messages from the offline cache after the flush. */
  patchFromCache: () => Promise<void>;
};

/**
 * The Meet notice bar row while queued chat writes fail to sync (#1565).
 * Retry flushes the outbox (which tells the other tabs), rereads the cache and
 * recounts. The failed messages themselves read "Not sent".
 */
export function useMeetChatSyncNotice({
  username,
  patchFromCache,
}: UseMeetChatSyncNoticeArgs): ActionNotice | null {
  const { count, refresh } = useFailedOutboxCount(username, listFailedMeetChatOutbox);

  const retry = useCallback(async () => {
    if (!username) return;
    try {
      await getMeetChatSyncRunner(username).flush();
    } finally {
      await patchFromCache().catch(() => undefined);
      await refresh();
    }
  }, [patchFromCache, refresh, username]);

  return useSyncRetryNotice({
    id: "sync:meet-chat",
    active: count > 0,
    title: meetLabels.syncFailedNotice,
    retryLabel: meetLabels.retrySync,
    onRetry: retry,
  });
}
