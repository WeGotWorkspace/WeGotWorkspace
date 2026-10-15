import { useCallback, useEffect, useState } from "react";
import { useConnectivity } from "@/hooks/use-connectivity";
import { listFailedNotesOutbox } from "@/lib/offline/notes-offline-store";

const POLL_INTERVAL_MS = 4000;

/**
 * Transient outbox failures plus metadata sync conflicts the listener reported.
 * Conflict ids are separate from `listFailedNotesOutbox`: a `stateMismatch` row
 * is not retryable, and a JMAP collision never writes an outbox error.
 */
export function useNotesFailedSync(
  username: string | null | undefined,
  refreshKey?: number,
  conflictNoteIds?: readonly string[],
): number {
  const [failedCount, setFailedCount] = useState(0);
  const { online } = useConnectivity();

  const refresh = useCallback(async () => {
    if (!username) {
      setFailedCount(0);
      return;
    }
    try {
      const rows = await listFailedNotesOutbox(username);
      setFailedCount(rows.length);
    } catch {
      // Keep the last known state if the offline store read fails.
    }
  }, [username]);

  useEffect(() => {
    void refresh();
    if (typeof window === "undefined") return;
    const intervalId = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [refresh, online, refreshKey]);

  return failedCount + (conflictNoteIds?.length ?? 0);
}
