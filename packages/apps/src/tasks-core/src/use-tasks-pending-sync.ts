import { useCallback, useEffect, useState } from "react";
import { useConnectivity } from "@/hooks/use-connectivity";
import { listPendingTaskIds } from "@/lib/offline/tasks/tasks-offline-store";

const POLL_INTERVAL_MS = 4000;

export function useTasksPendingSync(
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
      const ids = await listPendingTaskIds(username);
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
