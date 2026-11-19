import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { mergePendingApplyPoll } from "@/admin-core/src/admin-settings-form-utils";
import type {
  AdminAPIOperations,
  AdminUpdateProgress,
  AdminUpdateState,
} from "@/lib/models/admin-types";

/** Progress poll while an update runs (or right after Apply). */
export const UPDATE_PROGRESS_POLL_MS = 2_000;
/** Idle poll: notices an update started elsewhere, at most once a minute (#2242). */
export const UPDATE_IDLE_POLL_MS = 60_000;

type UseAdminUpdatePollArgs = {
  operations?: Pick<AdminAPIOperations, "refreshUpdateProgress" | "refreshUpdateState">;
  inProgress: boolean;
  setUpdates: Dispatch<SetStateAction<AdminUpdateState>>;
  applyRequestPendingRef: MutableRefObject<boolean>;
};

function mergeProgress(
  prev: AdminUpdateState,
  next: AdminUpdateProgress,
  applyPending: boolean,
): AdminUpdateState {
  if (applyPending && !next.inProgress) return mergePendingApplyPoll(prev, next);
  return { ...prev, ...next };
}

/**
 * Polls the cheap update progress endpoint: every 2 s while an update runs, once a minute
 * otherwise, never while the tab is hidden. When a run ends, the full update state
 * (version, checks, backups, result) is loaded once.
 */
export function useAdminUpdatePoll({
  operations,
  inProgress,
  setUpdates,
  applyRequestPendingRef,
}: UseAdminUpdatePollArgs) {
  const refreshProgress = operations?.refreshUpdateProgress;
  const refreshState = operations?.refreshUpdateState;

  useEffect(() => {
    if (!refreshProgress) return;
    const intervalMs = inProgress ? UPDATE_PROGRESS_POLL_MS : UPDATE_IDLE_POLL_MS;
    let cancelled = false;
    let timeoutId: number | null = null;
    let lastPollAt = Date.now();

    const poll = async () => {
      lastPollAt = Date.now();
      try {
        const next = await refreshProgress();
        if (cancelled) return;
        const applyPending = applyRequestPendingRef.current;
        if (inProgress && !next.inProgress && !applyPending && refreshState) {
          // The run ended: one full read picks up the new version, result and backups.
          const full = await refreshState();
          if (!cancelled) setUpdates(full);
          return;
        }
        setUpdates((prev) => mergeProgress(prev, next, applyPending));
      } catch {
        // Keep showing existing progress if a poll fails temporarily.
      }
    };

    const schedule = (delayMs: number) => {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      timeoutId = null;
      if (cancelled || document.hidden) return;
      timeoutId = window.setTimeout(() => {
        timeoutId = null;
        void poll().finally(() => schedule(intervalMs));
      }, delayMs);
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        schedule(0); // clears the timer: hidden tabs do not poll
        return;
      }
      schedule(Math.max(0, lastPollAt + intervalMs - Date.now()));
    };

    // During a run, read progress right away; when idle, the page data is fresh.
    schedule(inProgress ? 0 : intervalMs);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, [inProgress, refreshProgress, refreshState, setUpdates, applyRequestPendingRef]);
}
