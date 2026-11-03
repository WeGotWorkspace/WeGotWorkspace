import type { Dispatch, SetStateAction } from "react";
import { getConnectivitySnapshot } from "@/lib/offline/core/browser-online";

/** Waits before each automatic reload after a failed live listing. */
export const DOCS_LISTING_RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 20_000, 30_000] as const;

/**
 * Settles one live listing load. A loaded listing resets the backoff. A failed
 * one schedules the next reload, because a push already told us the list
 * changed and stale rows should not stay (#1663). The reload is cancelled when
 * `signal` aborts, so the caller's effect cleanup also stops it.
 */
export function retryFailedListing(
  failedReloads: { current: number },
  loaded: boolean,
  setReloadToken: Dispatch<SetStateAction<number>>,
  signal: AbortSignal,
): void {
  if (loaded) {
    failedReloads.current = 0;
    return;
  }
  const delay = DOCS_LISTING_RETRY_DELAYS_MS[failedReloads.current];
  failedReloads.current += 1;
  if (delay === undefined || !getConnectivitySnapshot() || signal.aborted) return;
  const timer = setTimeout(() => setReloadToken((token) => token + 1), delay);
  signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
}
