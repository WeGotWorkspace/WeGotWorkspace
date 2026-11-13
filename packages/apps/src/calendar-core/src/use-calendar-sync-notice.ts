import { useCallback } from "react";
import { getCalendarsSyncRunner } from "@/lib/offline/calendars/calendars-hybrid-operations";
import { listFailedCalendarOutbox } from "@/lib/offline/calendars/calendars-offline-store";
import { useFailedOutboxCount } from "@/lib/offline/use-failed-outbox-count";
import type { ActionNotice } from "@/notice-bar/src/notice-bar";
import { useSyncRetryNotice } from "@/notice-bar/src/use-sync-retry-notice";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";

type UseCalendarSyncNoticeArgs = {
  username: string | null;
  labels: CalendarUILabels;
  /** Rereads events from the offline cache after the flush. */
  reloadFromCache: () => Promise<unknown>;
};

/**
 * The Calendar notice bar row while queued event or calendar changes fail to
 * sync (#1895). Retry flushes the outbox, rereads the cache and recounts.
 */
export function useCalendarSyncNotice({
  username,
  labels,
  reloadFromCache,
}: UseCalendarSyncNoticeArgs): ActionNotice | null {
  const { count, refresh } = useFailedOutboxCount(username, listFailedCalendarOutbox);

  const retry = useCallback(async () => {
    if (!username) return;
    try {
      await getCalendarsSyncRunner(username).flush();
    } finally {
      await reloadFromCache().catch(() => undefined);
      await refresh();
    }
  }, [refresh, reloadFromCache, username]);

  return useSyncRetryNotice({
    id: "sync:calendar",
    active: count > 0,
    title: labels.syncFailedNotice,
    retryLabel: labels.retrySync,
    onRetry: retry,
  });
}
