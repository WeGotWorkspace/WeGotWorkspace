/**
 * File bytes already loaded for a preview in this tab, so going back to a
 * folder or reopening a file does not download them again (#2063 measurement 5).
 * Keyed by account, path and modified time: a new version of the file misses
 * the cache, and another account signed in to the same tab never reads it.
 * Bounded by bytes; the least recently used entries go first.
 */

/** Total bytes the cache keeps. */
export const PREVIEW_BLOB_CACHE_MAX_BYTES = 64 * 1024 * 1024;
/** A blob above this is not kept, so one large file cannot flush every thumbnail. */
export const PREVIEW_BLOB_CACHE_MAX_ENTRY_BYTES = 8 * 1024 * 1024;

const entries = new Map<string, Blob>();
let totalBytes = 0;

export function previewBlobCacheKey(
  account: string,
  apiPath: string,
  modifiedMs?: number | null,
): string {
  return `${account}:${apiPath.trim().replace(/^\/+/, "")}@${modifiedMs ?? ""}`;
}

export function readPreviewBlob(key: string): Blob | null {
  const blob = entries.get(key);
  if (!blob) return null;
  // Refresh recency.
  entries.delete(key);
  entries.set(key, blob);
  return blob;
}

export function writePreviewBlob(key: string, blob: Blob): void {
  if (blob.size > PREVIEW_BLOB_CACHE_MAX_ENTRY_BYTES) return;
  const existing = entries.get(key);
  if (existing) {
    totalBytes -= existing.size;
    entries.delete(key);
  }
  entries.set(key, blob);
  totalBytes += blob.size;
  for (const [oldestKey, oldest] of entries) {
    if (totalBytes <= PREVIEW_BLOB_CACHE_MAX_BYTES) break;
    entries.delete(oldestKey);
    totalBytes -= oldest.size;
  }
}

/** Test hook. */
export function clearPreviewBlobCache(): void {
  entries.clear();
  totalBytes = 0;
}
