import { useCallback, useEffect, useState } from "react";
import {
  isSyncNoticeOutboxRow,
  listOutboxMutationsForDomain,
} from "@/lib/offline/core/outbox-store";
import { listKeptUnsavedDocumentPaths } from "@/lib/offline/drive/drive-fetched-set-prune";
import { useOfflineConflictQueue } from "@/lib/offline/use-offline-conflict-queue";

type SetConflictListener = (listener: ((ids: string[]) => void) | undefined) => void;

type UseDomainOutboxNoticeArgs = {
  username: string | null | undefined;
  domain: string;
  setConflictListener: SetConflictListener;
  /** Bump after a flush so a newly failed row shows without a timer. */
  refreshKey?: number;
};

/**
 * No-poll sync notice for Docs and Drive. Refreshes on mount and when
 * `refreshKey` changes. `useContactsFailedSync` stays the poll variant
 * (interval plus a connectivity refresh). Notes keeps that same poll shape.
 * Calendar, Contacts, Notes, and Tasks still use their own hooks, and those
 * hooks list the same outbox rows through `isSyncNoticeOutboxRow`.
 *
 * `active` is true when any of these remain:
 * - a transient outbox failure (`isRetryableOutboxRow`)
 * - a permanent 403 or 404 outbox failure (`isPermanentlyFailedOutboxRow`)
 * - a conflict-channel id (revision conflict, or a path this notice reported)
 * - a document kept because it still has unsaved collab work
 *
 * The toast copy has to name both outbox classes. `clearConflicts` drops the
 * channel state so Retry can turn the notice off once the other counts are zero.
 */
export function useDomainOutboxNotice({
  username,
  domain,
  setConflictListener,
  refreshKey,
}: UseDomainOutboxNoticeArgs): { active: boolean; clearConflicts: () => void } {
  const { conflicts, clearConflicts } = useOfflineConflictQueue({
    setListener: setConflictListener,
  });
  const [failedCount, setFailedCount] = useState(0);
  const [keptCount, setKeptCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!username) {
      setFailedCount(0);
      setKeptCount(0);
      return;
    }
    try {
      const rows = await listOutboxMutationsForDomain(username, domain);
      setFailedCount(rows.filter(isSyncNoticeOutboxRow).length);
      const kept = await listKeptUnsavedDocumentPaths(username);
      setKeptCount(kept.length);
    } catch {
      // Keep the last known notice if the offline store read fails.
    }
  }, [domain, username]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  return {
    active: failedCount + keptCount + conflicts.length > 0,
    clearConflicts,
  };
}
