import { useCallback, useEffect, useState } from "react";
import { useConnectivity } from "@/hooks/use-connectivity";
import { listPendingContactCardIds } from "@/lib/offline/contacts/contacts-offline-store";

const POLL_INTERVAL_MS = 4000;

/**
 * Ids of contact cards with unsynced local changes, for the list pending-sync dot.
 * Re-reads from the offline store on mount, on connectivity changes, whenever
 * `refreshKey` changes (e.g. after a bootstrap refresh), and on a light poll so
 * the badge clears once a queued mutation flushes.
 */
export function useContactsPendingSync(
  username: string | null | undefined,
  refreshKey?: number,
): ReadonlySet<string> {
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(() => new Set<string>());
  const { online } = useConnectivity();

  const refresh = useCallback(async () => {
    if (!username) {
      setPendingIds(new Set<string>());
      return;
    }
    try {
      const ids = await listPendingContactCardIds(username);
      setPendingIds(new Set(ids));
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

  return pendingIds;
}
