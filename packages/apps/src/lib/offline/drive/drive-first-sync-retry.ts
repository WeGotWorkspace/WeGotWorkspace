import { getConnectivitySnapshot } from "@/lib/offline/core/browser-online";
import {
  readDriveTreeFirstSyncDone,
  readDriveTreeLastPass,
} from "@/lib/offline/drive/drive-tree-sync";

/** A first sync that did not finish runs again after this, doubling up to the max (#2063 C3). */
export const FIRST_SYNC_RETRY_BASE_MS = 2_000;
export const FIRST_SYNC_RETRY_MAX_MS = 60_000;

/**
 * True once this device finished the tree walk, or on a server without
 * the keyset the per-folder crawl. The crawl leaves `firstSyncDone` unset (a
 * keyset server still walks later) but its rows are what that server offers.
 */
export async function readDriveFirstPassDone(username: string): Promise<boolean> {
  const [firstSyncDone, lastPass] = await Promise.all([
    readDriveTreeFirstSyncDone(username),
    readDriveTreeLastPass(username),
  ]);
  return firstSyncDone || lastPass === "crawl";
}

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
    if (await readDriveFirstPassDone(username).catch(() => true)) return;
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
