import { wgwFetch, wgwReadJson } from "@/lib/api/wgw/http";
import type { WgwDriveDirectoryEntry, WgwDriveListingResponse } from "@/lib/api/wgw/types";
import { getConnectivitySnapshot } from "@/lib/offline/core/browser-online";
import { readMeta, writeMeta } from "@/lib/offline/core/meta-store";
import { writeDriveBootstrapToCache } from "@/lib/offline/drive/drive-directory-offline-store";
import { applyFetchedDirectorySnapshot } from "@/lib/offline/drive/drive-fetched-set-prune";
import type { DriveAppBootstrap } from "@/drive-core/src/drive-types";
import { normalizeApiVirtualPath as normalizePath } from "@/lib/files/api-path";

const DRIVE_METADATA_SYNC_META_KEY = "drive:metadata-sync:progress";

export type DriveMetadataSyncProgress = {
  running: boolean;
  total: number;
  synced: number;
  failed: number;
  updatedAt: number;
};

function emptyProgress(): DriveMetadataSyncProgress {
  return { running: false, total: 0, synced: 0, failed: 0, updatedAt: Date.now() };
}

function pathQuery(path: string): string {
  return `path=${encodeURIComponent(normalizePath(path))}`;
}

function isVisibleDriveEntry(entry: WgwDriveDirectoryEntry): boolean {
  return !entry.name.trim().startsWith(".");
}

function normalizeDriveEntryKey(path: string): string {
  return path.trim().replace(/^\/+/, "");
}

async function writeProgress(username: string, progress: DriveMetadataSyncProgress): Promise<void> {
  await writeMeta(username, DRIVE_METADATA_SYNC_META_KEY, JSON.stringify(progress));
}

async function fetchDirectoryEntries(
  dir: string,
  signal?: AbortSignal,
): Promise<WgwDriveDirectoryEntry[]> {
  const res = await wgwFetch(`/files/children?${pathQuery(dir)}`, { signal });
  if (!res.ok) throw new Error(`GET /files/children failed (${res.status})`);
  const payload = (await wgwReadJson(res)) as WgwDriveListingResponse;
  return payload.data.files.filter(isVisibleDriveEntry);
}

export async function readDriveMetadataSyncProgress(
  username: string,
): Promise<DriveMetadataSyncProgress> {
  const raw = await readMeta(username, DRIVE_METADATA_SYNC_META_KEY);
  if (!raw) return emptyProgress();
  try {
    return { ...emptyProgress(), ...(JSON.parse(raw) as Partial<DriveMetadataSyncProgress>) };
  } catch {
    return emptyProgress();
  }
}

async function collectMetadataRoots(username: string): Promise<string[]> {
  const userRoot = normalizePath(`/users/${username}`);
  const roots = [userRoot];
  try {
    const groups = await fetchDirectoryEntries("/groups");
    for (const entry of groups) {
      if (entry.type === "dir") {
        roots.push(normalizePath(entry.path));
      }
    }
  } catch {
    // Group roots are additive only.
  }
  return roots;
}

/** BFS crawl and cache the full drive metadata tree (always runs when online). */
export async function syncDriveMetadataTree(
  username: string,
  bootstrap: DriveAppBootstrap,
  options?: { signal?: AbortSignal },
): Promise<DriveMetadataSyncProgress> {
  if (!username || !getConnectivitySnapshot()) return emptyProgress();
  const signal = options?.signal;
  await writeDriveBootstrapToCache(username, bootstrap);

  const roots = await collectMetadataRoots(username);
  const visited = new Set<string>();
  const queue: string[] = [...roots];

  const progress: DriveMetadataSyncProgress = {
    running: true,
    total: 0,
    synced: 0,
    failed: 0,
    updatedAt: Date.now(),
  };
  await writeProgress(username, progress);

  while (queue.length > 0) {
    if (signal?.aborted) break;
    const dir = queue.shift()!;
    const normalized = normalizeDriveEntryKey(dir);
    if (visited.has(normalized)) continue;
    visited.add(normalized);
    progress.total += 1;
    try {
      const entries = await fetchDirectoryEntries(dir, signal);
      // Snapshot replaces upsert: a later JMAP crawl keeps this call and
      // stamps node ids after it. Do not prune in the catch below.
      await applyFetchedDirectorySnapshot(username, dir, entries);
      for (const entry of entries) {
        if (entry.type === "dir") {
          queue.push(normalizePath(entry.path));
        }
      }
      progress.synced += 1;
    } catch {
      progress.failed += 1;
    }
    progress.updatedAt = Date.now();
    await writeProgress(username, progress);
  }

  progress.running = false;
  progress.updatedAt = Date.now();
  await writeProgress(username, progress);
  return progress;
}

export async function refreshDriveDirectoryCache(
  username: string,
  parentPath: string,
  signal?: AbortSignal,
): Promise<void> {
  if (!getConnectivitySnapshot()) return;
  const entries = await fetchDirectoryEntries(parentPath, signal);
  await applyFetchedDirectorySnapshot(username, parentPath, entries);
}
