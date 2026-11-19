import type { DriveUIData } from "@/lib/files/drive-types";
import { withCrossTabLockIfFree } from "@/lib/offline/core/cross-tab-lock";
import { crossTabTopic, type CrossTabTopic } from "@/lib/offline/core/cross-tab-topic";

/** A tab fetched `path` for `username` after the change stamped `wave`. */
export type DriveFolderFetched = {
  v: 1;
  username: string;
  path: string;
  wave: number;
  data: DriveUIData;
};

function isDriveFolderFetched(value: unknown): value is DriveFolderFetched {
  const message = value as Partial<DriveFolderFetched> | null;
  return (
    message?.v === 1 &&
    typeof message.username === "string" &&
    typeof message.path === "string" &&
    typeof message.wave === "number" &&
    typeof message.data === "object" &&
    message.data !== null
  );
}

/** How long a tab waits for the fetching tab's listing before it fetches itself. */
export const DRIVE_FOLDER_FETCH_WAIT_MS = 5_000;

export type DriveFolderFetchShareDeps = {
  topic: CrossTabTopic<DriveFolderFetched>;
  /** Run `task` when no other tab holds the lock; undefined when one does. */
  lockIfFree: <T>(name: string, task: () => Promise<T>) => Promise<T | undefined>;
  waitMs: number;
};

export type DriveFolderFetchRequest = {
  username: string;
  /** API path of the folder. */
  path: string;
  /**
   * Time stamp of the change this fetch answers, the same in every tab
   * (`subscribeDriveRemoteChanges`). A listing fetched for an older change
   * may not hold this one, so it is not taken over.
   */
  wave: number;
  /** The live fetch, including this tab's cache writes. Aborting `signal` stops it. */
  fetchLive: (signal?: AbortSignal) => Promise<DriveUIData>;
  signal?: AbortSignal;
};

/**
 * Fetch an open folder once per browser after a change (#2261). Every
 * tab that shows the folder hears the change. The first one fetches and hands
 * its listing to the others; they wait for it instead of fetching the same
 * rows. A tab fetches for itself when no listing comes within `waitMs` (the
 * fetching tab failed or closed), and always without Web Locks.
 */
export function createDriveFolderFetchShare(deps: DriveFolderFetchShareDeps) {
  return async function fetchOncePerBrowser(
    request: DriveFolderFetchRequest,
  ): Promise<DriveUIData> {
    const { username, path, wave, fetchLive, signal } = request;
    let heard: DriveUIData | null = null;
    let onHeard: (data: DriveUIData) => void = () => undefined;
    const listing = new Promise<DriveUIData>((resolve) => {
      onHeard = resolve;
    });
    const stopListening = deps.topic.subscribe((message) => {
      if (message.username !== username || message.path !== path || message.wave < wave) return;
      heard = message.data;
      onHeard(message.data);
    });
    const heardSoFar = (): DriveUIData | null => heard;
    try {
      const mine = await deps.lockIfFree(`wgw.drive.folder-fetch.${username}.${path}`, async () => {
        // Another tab finished between the change and this tab's turn.
        if (heardSoFar()) return null;
        const data = await fetchLive(signal);
        deps.topic.publish({ v: 1, username, path, wave, data }, { otherTabsOnly: true });
        return data;
      });
      if (mine) return mine;
      let stopWaiting: () => void = () => undefined;
      const waited = new Promise<null>((resolve) => {
        const timer = setTimeout(() => resolve(null), deps.waitMs);
        stopWaiting = () => {
          clearTimeout(timer);
          resolve(null);
        };
        signal?.addEventListener("abort", stopWaiting, { once: true });
      });
      const shared = await Promise.race([listing, waited]);
      stopWaiting();
      signal?.removeEventListener("abort", stopWaiting);
      if (shared) return shared;
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      // A slow fetching tab may still answer first: take whichever listing
      // comes and stop the local fetch so it writes nothing older.
      const local = new AbortController();
      const stopLocal = () => local.abort();
      signal?.addEventListener("abort", stopLocal, { once: true });
      const fetched = fetchLive(local.signal);
      fetched.catch(() => undefined);
      try {
        return await Promise.race([listing, fetched]);
      } finally {
        signal?.removeEventListener("abort", stopLocal);
        local.abort();
      }
    } finally {
      stopListening();
    }
  };
}

let browserShare: ReturnType<typeof createDriveFolderFetchShare> | undefined;

/** The share between the tabs of this browser. */
export function fetchDriveFolderOncePerBrowser(
  request: DriveFolderFetchRequest,
): Promise<DriveUIData> {
  browserShare ??= createDriveFolderFetchShare({
    topic: crossTabTopic<DriveFolderFetched>("wgw.drive.folder-fetched", isDriveFolderFetched),
    lockIfFree: withCrossTabLockIfFree,
    waitMs: DRIVE_FOLDER_FETCH_WAIT_MS,
  });
  return browserShare(request);
}
