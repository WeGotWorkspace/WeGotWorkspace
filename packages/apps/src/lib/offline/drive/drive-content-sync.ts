import { wgwFetch } from "@/lib/api/wgw/http";
import { isDocsCollabEditablePath } from "@/docs-core/src/docs-collab-text-files";
import { normalizeApiVirtualPath } from "@/drive-core/src/drive-path-utils";
import {
  backgroundSyncPacer,
  BackgroundSyncRateLimitedError,
  parseRetryAfterMs,
} from "@/lib/offline/core/background-sync-pacer";
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
import { readDriveEntryFromCache } from "@/lib/offline/drive/drive-directory-offline-store";

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

async function fetchFileBlob(apiPath: string, signal?: AbortSignal): Promise<Blob> {
  const normalized = normalizeApiVirtualPath(apiPath);
  const res = await wgwFetch(`/files/content?path=${encodeURIComponent(normalized)}`, { signal });
  if (res.status === 429) {
    throw new BackgroundSyncRateLimitedError(
      "GET /files/content failed (429)",
      parseRetryAfterMs(res.headers.get("Retry-After")),
    );
  }
  if (!res.ok) throw new Error(`GET /files/content failed (${res.status})`);
  return res.blob();
}

async function needsContentResync(
  username: string,
  apiPath: string,
  entryModifiedAt: number,
): Promise<boolean> {
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
    });
    await writeDriveAvailability(username, {
      id: room,
      source: options?.source ?? "auto",
      entryModifiedAt,
    });
    await markDriveAvailabilitySynced(username, room, entryModifiedAt);
    return;
  }

  await options?.beforeRequest?.();
  const blob = await fetchFileBlob(normalized, options?.signal);
  await writeDriveContentBlob(username, normalized, blob, entryModifiedAt);
  if (options?.source === "manual") {
    await writeDriveAvailability(username, { id: room, source: "manual", entryModifiedAt });
  }
}

export async function syncDriveContentFromCache(
  username: string,
  filePaths: readonly string[],
  options?: { signal?: AbortSignal },
): Promise<DriveContentSyncProgress> {
  if (!username || !getConnectivitySnapshot()) return emptyProgress();
  const settings = readOfflineDeviceContentSettings();
  if (!settings.contentSyncEnabled) return emptyProgress();

  const queue: Array<{ path: string; modifiedAt: number; size: number }> = [];
  for (const path of filePaths) {
    const entry = await readDriveEntryFromCache(username, path);
    if (!entry || entry.type !== "file") continue;
    const size = entry.size ?? 0;
    if (!isEligibleForAutoContentSync(size, settings)) continue;
    if (!(await needsContentResync(username, path, entry.time ?? 0))) continue;
    queue.push({ path, modifiedAt: entry.time ?? 0, size });
  }

  queue.sort((a, b) => b.modifiedAt - a.modifiedAt);

  const signal = options?.signal;
  const pacer = backgroundSyncPacer();
  return runProgressiveSync({
    username,
    metaKey: DRIVE_CONTENT_SYNC_META_KEY,
    items: queue,
    concurrency: DRIVE_CONTENT_SYNC_CONCURRENCY,
    signal,
    pacer,
    syncOne: async (item) => {
      await syncDriveFileContent(username, item.path, {
        source: "auto",
        signal,
        beforeRequest: () => pacer.acquire(signal),
      });
    },
  });
}

export async function syncAllDriveContentFromCache(
  username: string,
  filePaths: readonly string[],
  options?: { signal?: AbortSignal },
): Promise<DriveContentSyncProgress> {
  return syncDriveContentFromCache(username, filePaths, options);
}
