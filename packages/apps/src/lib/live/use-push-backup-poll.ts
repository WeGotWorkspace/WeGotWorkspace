import { useEffect, useMemo } from "react";
import { useJmapPushHealthy, type JmapPushHubLike } from "@/lib/api/wgw/use-jmap-state-change";
import { defaultJmapPushHub } from "@/lib/api/wgw/jmap-push";

/** What a backup poll drives: a JMAP inbound adapter, or `intervalPollTarget`. */
export type BackupPollTarget = {
  startPolling: (intervalMs: number) => void;
  stopPolling: () => void;
};

/**
 * The one backup poll of every inbound sync (#2296). The push stream is the
 * doorbell; the poll only covers the time it is not healthy, so it runs while
 * push is down and stops while push works. Backup resumes within one interval
 * after push stops. `target` is null until the sync has something to poll.
 */
export function usePushBackupPoll(
  target: BackupPollTarget | null,
  intervalMs: number,
  hub: JmapPushHubLike | null = defaultJmapPushHub(),
): void {
  const healthy = useJmapPushHealthy(hub);
  useEffect(() => {
    if (!target || healthy) return;
    target.startPolling(intervalMs);
    return () => target.stopPolling();
  }, [healthy, intervalMs, target]);
}

/** A poll target for a sync that is not an adapter: runs `tick` on an interval. */
export function useIntervalPollTarget(tick: (() => void) | null): BackupPollTarget | null {
  return useMemo(() => {
    if (!tick) return null;
    let timer: ReturnType<typeof setInterval> | undefined;
    return {
      startPolling: (intervalMs) => {
        if (timer !== undefined) clearInterval(timer);
        timer = setInterval(tick, intervalMs);
      },
      stopPolling: () => {
        if (timer !== undefined) clearInterval(timer);
        timer = undefined;
      },
    };
  }, [tick]);
}
