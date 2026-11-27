import type { WgwDriveDirectoryEntry } from "@/lib/api/wgw/types";
import { DOCS_HOME_EXTENSIONS } from "@/lib/files/docs-home-listing";
import { queryFileTreeView } from "@/lib/files/tree-view/tree-view-query";
import { backgroundSyncPacer } from "@/lib/offline/core/background-sync-pacer";
import { getConnectivitySnapshot } from "@/lib/offline/core/browser-online";
import {
  isEligibleForAutoContentSync,
  readOfflineDeviceContentSettings,
} from "@/lib/offline/core/offline-device-settings";
import {
  emptyProgressiveSyncProgress,
  readProgressiveSyncProgress,
  runProgressiveSync,
  type ProgressiveSyncProgress,
} from "@/lib/offline/core/progressive-sync-runner";
import { withCrossTabLockIfFree } from "@/lib/offline/core/cross-tab-lock";
import { makeDocsOfflineAvailable } from "@/lib/offline/docs/docs-offline-pin-core";
import { collabUploadLockName } from "@/lib/collab/docs-collab-pending-registry";
import { docsCollabRoomKey, resolveDocsCollabDatabase } from "@/lib/collab/docs-collab-persistence";

const DOCS_BODY_SYNC_META_KEY = "docs:auto-sync:body-progress";
/** Low on purpose: the pacer sets the rate; this keeps browser connections free for the user. */
const DOCS_BODY_SYNC_CONCURRENCY = 2;

export type DocsBodySyncProgress = ProgressiveSyncProgress;

function emptyProgress(): DocsBodySyncProgress {
  return emptyProgressiveSyncProgress();
}

function sourceKey(path: string): string {
  return path.trim().replace(/^\/+/, "");
}

function fileLocationFromSourceKey(key: string, username: string): string {
  if (key.startsWith(`users/${username}/`)) return "My Drive";
  if (key.startsWith("groups/")) {
    const team = key.split("/")[1] ?? "Team";
    return `Team: ${team}`;
  }
  return "Documents";
}

/** Listing mtime (seconds) in ms; `undefined` when the index has none. */
export function listingModifiedAtMs(modifiedAt: number | null | undefined): number | undefined {
  return typeof modifiedAt === "number" && modifiedAt > 0 ? modifiedAt * 1000 : undefined;
}

export async function readDocsBodySyncProgress(username: string): Promise<DocsBodySyncProgress> {
  return readProgressiveSyncProgress(username, DOCS_BODY_SYNC_META_KEY);
}

/**
 * The documents whose bodies the device keeps: every Markdown and plain-text
 * file of home and the team drives in the local tree (#2063 C4), newest first.
 * Nothing is fetched to find them.
 */
export async function readDocsBodySyncCandidates(
  username: string,
): Promise<WgwDriveDirectoryEntry[]> {
  const { rows } = await queryFileTreeView(
    username,
    { kind: "all" },
    { extensions: DOCS_HOME_EXTENSIONS, filesOnly: true },
    true,
  );
  return [...rows].sort((a, b) => (b.time ?? 0) - (a.time ?? 0));
}

/** Fetch the bodies of the tree's documents that changed since their last sync. */
export async function syncDocsBodiesFromTree(
  username: string,
  options?: { signal?: AbortSignal },
): Promise<DocsBodySyncProgress> {
  if (!username || !getConnectivitySnapshot()) return emptyProgress();
  const settings = readOfflineDeviceContentSettings();
  if (!settings.contentSyncEnabled) return emptyProgress();

  const signal = options?.signal;
  const queue = (await readDocsBodySyncCandidates(username)).filter((entry) =>
    isEligibleForAutoContentSync(entry.size, settings),
  );

  const pacer = backgroundSyncPacer();
  return runProgressiveSync({
    username,
    metaKey: DOCS_BODY_SYNC_META_KEY,
    items: queue,
    concurrency: DOCS_BODY_SYNC_CONCURRENCY,
    signal,
    pacer,
    syncOne: async (entry) => {
      const key = sourceKey(entry.path);
      const apiPath = `/${key}`;
      const database = await resolveDocsCollabDatabase(docsCollabRoomKey(apiPath));
      // An open editor holds this lock for its room, in any tab; it owns the body.
      await withCrossTabLockIfFree(collabUploadLockName(database.name), () =>
        makeDocsOfflineAvailable(username, apiPath, fileLocationFromSourceKey(key, username), {
          beforeRequest: () => pacer.acquire(signal),
          // Drive sync usually got here first; an unchanged document costs no request.
          // An unknown mtime means "fetch": it never proves the local copy is current.
          modifiedAtMs: listingModifiedAtMs(entry.time),
        }),
      );
    },
  });
}

const bodySyncRuns = new Map<string, AbortController>();

/**
 * Run {@link syncDocsBodiesFromTree} for the tree as it is now (#2063 C4). A
 * request while a run is busy stops that run and starts again: the queue is
 * newest first, so a Doc the tree just learned is fetched next, and the Docs
 * the stopped run already stored cost no request. Docs home used to start this
 * after each live listing; now the tree changing is the signal.
 */
export async function requestDocsBodySyncFromTree(
  username: string,
  options?: { signal?: AbortSignal },
): Promise<void> {
  bodySyncRuns.get(username)?.abort();
  const controller = new AbortController();
  bodySyncRuns.set(username, controller);
  const outer = options?.signal;
  const stop = () => controller.abort();
  outer?.addEventListener("abort", stop, { once: true });
  try {
    await syncDocsBodiesFromTree(username, { signal: controller.signal });
  } catch {
    // A failed run leaves its Docs for the next request.
  } finally {
    outer?.removeEventListener("abort", stop);
    if (bodySyncRuns.get(username) === controller) bodySyncRuns.delete(username);
  }
}
