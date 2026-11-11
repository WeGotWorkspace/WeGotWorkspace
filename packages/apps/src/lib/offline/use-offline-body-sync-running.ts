import { useEffect, useState } from "react";

export type OfflineBodySyncProgress = {
  running: boolean;
  total: number;
  synced: number;
  failed: number;
  updatedAt: number;
};

type UseOfflineBodySyncRunningOptions = {
  enabled: boolean;
  readProgress: () => Promise<OfflineBodySyncProgress>;
  pollMs?: number;
};

/**
 * Whether the background body sync is running, polled from its stored progress.
 *
 * Only the flag is state: the counts change on every poll while a sync runs, and
 * each change would re-render the caller's whole page (1,000 Docs rows) for nothing.
 */
export function useOfflineBodySyncRunning({
  enabled,
  readProgress,
  pollMs = 1500,
}: UseOfflineBodySyncRunningOptions): boolean {
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setRunning(false);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      const next = await readProgress().catch(() => null);
      if (!cancelled && next) {
        setRunning(next.running);
      }
      if (cancelled) return;
      timer = setTimeout(tick, pollMs);
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [enabled, pollMs, readProgress]);

  return running;
}
