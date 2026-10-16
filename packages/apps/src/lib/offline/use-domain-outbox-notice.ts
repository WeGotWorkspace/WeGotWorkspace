import { useCallback, useEffect, useState } from "react";
import {
  isRetryableOutboxRow,
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
 * Failed outbox rows (`isRetryableOutboxRow`) plus the conflict channel and
 * documents kept because they still have unsaved collab work. No poll: the
 * caller refreshes on mount and after reconnect flush.
 */
export function useDomainOutboxNotice({
  username,
  domain,
  setConflictListener,
  refreshKey,
}: UseDomainOutboxNoticeArgs): { active: boolean } {
  const { conflicts } = useOfflineConflictQueue({ setListener: setConflictListener });
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
      setFailedCount(rows.filter(isRetryableOutboxRow).length);
      const kept = await listKeptUnsavedDocumentPaths(username);
      setKeptCount(kept.length);
    } catch {
      // Keep the last known notice if the offline store read fails.
    }
  }, [domain, username]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  return { active: failedCount + keptCount + conflicts.length > 0 };
}
