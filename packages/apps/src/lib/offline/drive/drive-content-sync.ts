import { wgwFetch } from "@/lib/api/wgw/http";
import { isDocsCollabEditablePath } from "@/lib/files/docs-collab-text-files";
import { normalizeApiVirtualPath } from "@/lib/files/drive-path-utils";
import {
  backgroundSyncPacer,
  BackgroundSyncRateLimitedError,
  isRateLimitedError,
  parseRetryAfterMs,
} from "@/lib/offline/core/background-sync-pacer";
import { getConnectivitySnapshot } from "@/lib/offline/core/browser-online";
import {
  isEligibleForAutoContentSync,
  readOfflineDeviceContentSettings,
} from "@/lib/offline/core/offline-device-settings";
import {
  emptyProgressiveSyncProgress,
  MAX_RATE_LIMITED_ATTEMPTS,
  readProgressiveSyncProgress,
  runProgressiveSync,
  type ProgressiveSyncProgress,
} from "@/lib/offline/core/progressive-sync-runner";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import {
  markDriveAvailabilitySynced,
  writeDriveAvailability,
} from "@/lib/offline/drive/drive-availability-store";
import {
  driveContentBlobsTable,
  type OfflineDriveContentBlobRow,
} from "@/lib/offline/drive/drive-schema";
import { listingModifiedAtMs } from "@/lib/offline/docs/docs-body-sync";
import { makeDocsOfflineAvailable } from "@/lib/offline/docs/docs-offline-pin-core";
import { readDocsAvailability } from "@/lib/offline/docs/docs-availability-store";
import { hasDocsCollabOfflinePersistence } from "@/lib/offline/docs/docs-collab-offline-availability";
import { CollabHttpError } from "@/lib/collab/docs-collab-utils";
import { readDriveEntryFromCache } from "@/lib/offline/drive/drive-directory-offline-store";
import {
  beginDriveContentRun,
  clearDriveContentFailure,
  endDriveContentRun,
  finishDriveContentRunItem,
  isCurrentDriveContentRun,
  readDriveContentFailures,
  recordDriveContentFailure,
  shouldAutoRetryDriveContent,
} from "@/lib/offline/drive/drive-content-run-state";

const DRIVE_CONTENT_SYNC_META_KEY = "drive:auto-sync:content-progress";
/** Low on purpose: the pacer sets the rate; this keeps browser connections free for the user. */
const DRIVE_CONTENT_SYNC_CONCURRENCY = 2;

export type DriveContentSyncProgress = ProgressiveSyncProgress;

function emptyProgress(): DriveContentSyncProgress {
  return emptyProgressiveSyncProgress();
}

export async function readDriveContentSyncProgress(
  username: string,
): Promise<DriveContentSyncProgress> {
  return readProgressiveSyncProgress(username, DRIVE_CONTENT_SYNC_META_KEY);
}

async function readCachedBlob(
  username: string,
  apiPath: string,
): Promise<OfflineDriveContentBlobRow | undefined> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  return driveContentBlobsTable(db).get(apiPath.trim().replace(/^\/+/, ""));
}

export async function writeDriveContentBlob(
  username: string,
  apiPath: string,
  blob: Blob,
  entryModifiedAt?: number | null,
): Promise<void> {
  const id = apiPath.trim().replace(/^\/+/, "");
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  await driveContentBlobsTable(db).put({
    id,
    size: blob.size,
    mimeType: blob.type || "application/octet-stream",
    syncedAt: Date.now(),
    blob,
  });
  await writeDriveAvailability(username, {
    id,
    source: "auto",
    entryModifiedAt: entryModifiedAt ?? null,
  });
  await markDriveAvailabilitySynced(username, id, entryModifiedAt ?? null);
}

export async function removeDriveContentBlob(username: string, apiPath: string): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  await driveContentBlobsTable(db).delete(apiPath.trim().replace(/^\/+/, ""));
}

export async function migrateDriveContentBlobPath(
  username: string,
  oldPath: string,
  newPath: string,
): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const table = driveContentBlobsTable(db);
  const oldId = oldPath.trim().replace(/^\/+/, "");
  const newId = newPath.trim().replace(/^\/+/, "");
  const existing = await table.get(oldId);
  if (!existing) return;
  await table.put({ ...existing, id: newId });
  await table.delete(oldId);
}

/**
 * The server answered the content GET with an error. Only this counts as a
 * failed download: a `fetch` that throws (offline, aborted) says nothing about
 * the file itself.
 */
export class DriveContentHttpError extends Error {
  constructor(readonly status: number) {
    super(`GET /files/content failed (${status})`);
    this.name = "DriveContentHttpError";
  }
}

async function fetchFileBlob(apiPath: string, signal?: AbortSignal): Promise<Blob> {
  const normalized = normalizeApiVirtualPath(apiPath);
  const res = await wgwFetch(`/files/content?path=${encodeURIComponent(normalized)}`, { signal });
  if (res.status === 429) {
    throw new BackgroundSyncRateLimitedError(
      "GET /files/content failed (429)",
      parseRetryAfterMs(res.headers.get("Retry-After")),
    );
  }
  if (!res.ok) throw new DriveContentHttpError(res.status);
  return res.blob();
}

/**
 * A collab text file is current when Docs synced it at or after the listing's
 * mtime and its local Y.Doc has content. Docs keeps such a copy as it is, so
 * queueing it would only spin the row.
 */
async function isCollabCopyCurrent(
  username: string,
  room: string,
  entryModifiedAt: number,
): Promise<boolean> {
  const modifiedAtMs = listingModifiedAtMs(entryModifiedAt);
  const lastSyncedAt = (await readDocsAvailability(username, room))?.lastSyncedAt ?? null;
  if (lastSyncedAt == null || modifiedAtMs == null || lastSyncedAt < modifiedAtMs) return false;
  return hasDocsCollabOfflinePersistence(room);
}

/** The server refused the file itself (not a 429, not a dropped connection). */
function isFileHttpFailure(error: unknown): boolean {
  if (error instanceof DriveContentHttpError) return true;
  return error instanceof CollabHttpError && error.status !== 429;
}

async function needsContentResync(
  username: string,
  apiPath: string,
  entryModifiedAt: number,
): Promise<boolean> {
  const room = normalizeApiVirtualPath(apiPath).replace(/^\/+/, "");
  if (isDocsCollabEditablePath(room)) {
    return !(await isCollabCopyCurrent(username, room, entryModifiedAt));
  }
  const cached = await readCachedBlob(username, apiPath);
  if (!cached) return true;
  const availability = await readDriveEntryFromCache(username, apiPath);
  const modifiedAt = availability?.time ?? entryModifiedAt;
  return cached.syncedAt < modifiedAt * 1000;
}

export async function syncDriveFileContent(
  username: string,
  apiPath: string,
  options?: {
    source?: "auto" | "manual";
    signal?: AbortSignal;
    /** Background sync paces every request through this. */
    beforeRequest?: () => Promise<void>;
    /** False once a newer run replaced this one: the late answer is dropped. */
    shouldWrite?: () => boolean;
  },
): Promise<void> {
  const normalized = normalizeApiVirtualPath(apiPath);
  const room = normalized.replace(/^\/+/, "");
  const entry = await readDriveEntryFromCache(username, room);
  const entryModifiedAt = entry?.time ?? null;
  const background = options?.source !== "manual";

  if (isDocsCollabEditablePath(room)) {
    await makeDocsOfflineAvailable(username, normalized, "", {
      beforeRequest: options?.beforeRequest,
      // Background sync skips a document whose local copy is newer than the file.
      modifiedAtMs: background ? listingModifiedAtMs(entryModifiedAt) : undefined,
      shouldWrite: options?.shouldWrite,
    });
    if (options?.shouldWrite && !options.shouldWrite()) return;
    await writeDriveAvailability(username, {
      id: room,
      source: options?.source ?? "auto",
      entryModifiedAt,
    });
    await markDriveAvailabilitySynced(username, room, entryModifiedAt);
    await clearDriveContentFailure(username, room);
    return;
  }

  await options?.beforeRequest?.();
  const blob = await fetchFileBlob(normalized, options?.signal);
  // A slow answer for a replaced run must not overwrite the newer run's copy.
  if (options?.shouldWrite && !options.shouldWrite()) return;
  await writeDriveContentBlob(username, normalized, blob, entryModifiedAt);
  if (options?.source === "manual") {
    await writeDriveAvailability(username, { id: room, source: "manual", entryModifiedAt });
  }
  // The put took time: a newer run may have recorded a failure meanwhile.
  if (options?.shouldWrite && !options.shouldWrite()) return;
  await clearDriveContentFailure(username, room);
}

export async function syncDriveContentFromCache(
  username: string,
  filePaths: readonly string[],
  options?: { signal?: AbortSignal },
): Promise<DriveContentSyncProgress> {
  if (!username || !getConnectivitySnapshot()) return emptyProgress();
  const settings = readOfflineDeviceContentSettings();
  if (!settings.contentSyncEnabled) return emptyProgress();

  const failures = await readDriveContentFailures(username);
  const queue: Array<{ path: string; modifiedAt: number; size: number }> = [];
  for (const path of filePaths) {
    const entry = await readDriveEntryFromCache(username, path);
    if (!entry || entry.type !== "file") continue;
    const size = entry.size ?? 0;
    if (!isEligibleForAutoContentSync(size, settings)) continue;
    const modifiedAt = entry.time ?? 0;
    // A file that keeps failing waits for a new version or a manual pin.
    if (!shouldAutoRetryDriveContent(failures[path.replace(/^\/+/, "")], modifiedAt)) continue;
    if (!(await needsContentResync(username, path, modifiedAt))) continue;
    queue.push({ path, modifiedAt, size });
  }

  queue.sort((a, b) => b.modifiedAt - a.modifiedAt);

  const signal = options?.signal;
  const pacer = backgroundSyncPacer();
  // Rows spin only for the files in this queue, and only until each one is done.
  const run = beginDriveContentRun(
    username,
    queue.map((item) => item.path),
  );
  /** 429s per path: the runner gives up after MAX_RATE_LIMITED_ATTEMPTS. */
  const rateLimited = new Map<string, number>();
  try {
    return await runProgressiveSync({
      username,
      metaKey: DRIVE_CONTENT_SYNC_META_KEY,
      items: queue,
      concurrency: DRIVE_CONTENT_SYNC_CONCURRENCY,
      signal,
      pacer,
      syncOne: async (item) => {
        try {
          await syncDriveFileContent(username, item.path, {
            source: "auto",
            signal,
            beforeRequest: () => pacer.acquire(signal),
            shouldWrite: () => isCurrentDriveContentRun(run),
          });
        } catch (error) {
          if (isRateLimitedError(error)) {
            // The runner retries a 429, so the row keeps spinning until it gives up.
            const attempts = (rateLimited.get(item.path) ?? 0) + 1;
            rateLimited.set(item.path, attempts);
            if (attempts >= MAX_RATE_LIMITED_ATTEMPTS || signal?.aborted) {
              finishDriveContentRunItem(run, item.path);
            }
            throw error;
          }
          // Only a server error is about the file; a replaced run records nothing.
          if (isFileHttpFailure(error) && isCurrentDriveContentRun(run)) {
            await recordDriveContentFailure(username, item.path, item.modifiedAt);
          }
          finishDriveContentRunItem(run, item.path);
          throw error;
        }
        finishDriveContentRunItem(run, item.path);
      },
    });
  } finally {
    endDriveContentRun(run);
  }
}

export async function syncAllDriveContentFromCache(
  username: string,
  filePaths: readonly string[],
  options?: { signal?: AbortSignal },
): Promise<DriveContentSyncProgress> {
  return syncDriveContentFromCache(username, filePaths, options);
}
