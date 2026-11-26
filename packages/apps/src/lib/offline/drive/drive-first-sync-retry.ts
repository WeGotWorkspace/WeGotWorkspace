import { getConnectivitySnapshot } from "@/lib/offline/core/browser-online";
import { readDriveTreeFirstSyncDone } from "@/lib/offline/drive/drive-tree-sync";

/** A first sync that did not finish runs again after this, doubling up to the max (#2063 C3). */
export const FIRST_SYNC_RETRY_BASE_MS = 2_000;
export const FIRST_SYNC_RETRY_MAX_MS = 60_000;

/**
 * Runs `sync` now and, while the first sync on this device has not finished,
 * again with a backoff while online. Until then every Drive view waits on it
 * (full-pane loading), so a failed or cut-off pass must not wait for a reload.
 * After the first sync only app open, reconnect and pushes sync, as before.
 * Stops when `signal` aborts or `isCurrent` turns false (a newer trigger owns
 * the retries). Returns a function that cancels the pending retry.
 */
export function syncUntilFirstSyncDone(
  username: string,
  sync: () => Promise<unknown>,
  options: { signal: AbortSignal; isCurrent: () => boolean },
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;
  const stopped = () => options.signal.aborted || !options.isCurrent();

  const retryIfUnfinished = async () => {
    if (stopped() || !getConnectivitySnapshot()) return;
    if (await readDriveTreeFirstSyncDone(username).catch(() => true)) return;
    if (stopped()) return;
    const delay = Math.min(FIRST_SYNC_RETRY_BASE_MS * 2 ** attempt, FIRST_SYNC_RETRY_MAX_MS);
    attempt += 1;
    timer = setTimeout(run, delay);
  };
  const run = () => {
    void sync()
      .catch(() => undefined)
      .finally(() => void retryIfUnfinished());
  };
  run();
  return () => clearTimeout(timer);
}
