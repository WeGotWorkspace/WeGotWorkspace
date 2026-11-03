import { useCallback, useEffect, useState } from "react";
import { useConnectivity } from "@/hooks/use-connectivity";

const POLL_INTERVAL_MS = 4000;

/**
 * How many outbox rows of one app failed to sync (`isSyncNoticeOutboxRow`).
 * Refreshes on mount, on connectivity changes, when `refreshKey` changes, and
 * on a light poll, so a notice clears once a retry succeeds. `refresh` rereads
 * at once, e.g. right after a Retry.
 */
export function useFailedOutboxCount(
  username: string | null | undefined,
  listFailed: (username: string) => Promise<readonly unknown[]>,
  refreshKey?: number,
): { count: number; refresh: () => Promise<void> } {
  const [count, setCount] = useState(0);
  const { online } = useConnectivity();

  const refresh = useCallback(async () => {
    if (!username) {
      setCount(0);
      return;
    }
    try {
      setCount((await listFailed(username)).length);
    } catch {
      // Keep the last known state if the offline store read fails.
    }
  }, [listFailed, username]);

  useEffect(() => {
    void refresh();
    if (typeof window === "undefined") return;
    const intervalId = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [refresh, online, refreshKey]);

  return { count, refresh };
}
