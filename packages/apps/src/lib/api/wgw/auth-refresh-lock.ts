import { resetCrossTabLockForTests, withCrossTabLock } from "@/lib/cross-tab/cross-tab-lock";

/**
 * Lock name for token refresh. Never reuse it for another caller: the Drive
 * uploader holds its own lock while it calls `wgwFetch`, and `wgwFetch` takes
 * this one to renew the token. A shared name would make each wait for the other.
 */
export const AUTH_REFRESH_LOCK_NAME = "wgw-auth-refresh";

/** A refresh is sub-second; a record this old belongs to a tab that died mid-refresh. */
const AUTH_REFRESH_STALE_MS = 30_000;

let inTabRefreshPromise: Promise<boolean> | null = null;

/**
 * Coalesce refresh calls in-tab and run the refresh under the cross-tab lock.
 * A tab that waited runs the task itself once the holder is done; the task
 * re-reads the stored tokens first, so it returns early when the holder
 * already refreshed.
 */
export function withAuthRefreshLock(task: () => Promise<boolean>): Promise<boolean> {
  if (inTabRefreshPromise) {
    return inTabRefreshPromise;
  }
  const locked = withCrossTabLock(AUTH_REFRESH_LOCK_NAME, () => task(), {
    staleAfterMs: AUTH_REFRESH_STALE_MS,
  });
  inTabRefreshPromise = locked.finally(() => {
    inTabRefreshPromise = null;
  });
  return inTabRefreshPromise;
}

export function resetAuthRefreshLockForTests(): void {
  inTabRefreshPromise = null;
  // Also drops the in-tab queue, so a task a test left hanging cannot block the next test.
  resetCrossTabLockForTests();
}
