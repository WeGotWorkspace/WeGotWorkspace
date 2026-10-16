import { isDocsCollabEditablePath } from "@/docs-core/src/docs-collab-text-files";
import type { WgwDriveDirectoryEntry } from "@/lib/api/wgw/types";
import { parentAndName } from "@/lib/files/api-path";
import { readMeta, writeMeta } from "@/lib/offline/core/meta-store";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import {
  normalizeDocsAvailabilityPath,
  removeDocsAvailability,
} from "@/lib/offline/docs/docs-availability-store";
import { reportDocsSyncConflicts } from "@/lib/offline/docs/docs-sync-conflicts";
import {
  normalizeDriveEntryPath,
  upsertDriveEntries,
} from "@/lib/offline/drive/drive-directory-offline-store";
import { driveEntriesTable } from "@/lib/offline/drive/drive-schema";
import { reportDriveSyncConflicts } from "@/lib/offline/drive/drive-sync-conflicts";
import {
  clearDocsCollabOfflinePersistence,
  docsCollabIndexedDbKey,
  docsCollabLegacyIndexedDbKeys,
  docsCollabRoomKey,
} from "@/text-editor-core/docs-collab/docs-collab-persistence";
import { PENDING_SERVER_SAVE_KEY } from "@/text-editor-core/docs-collab/pending-server-save-key";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";

/** Paths kept because `PENDING_SERVER_SAVE_KEY` is set. Both home notices read this. */
export const KEPT_UNSAVED_DOCUMENTS_META_KEY = "drive:kept-unsaved-documents";

export type FetchedDirectorySnapshotResult = {
  /** Child paths removed from `drive_entries`. */
  removedPaths: string[];
  /** Child paths left in place because they still have unsaved collab work. */
  keptUnsavedPaths: string[];
};

/**
 * Upsert the listing, then drop cached children of `parentPath` that the
 * listing did not return. Call this only after that one folder fetch succeeded.
 * A caller that caught a failed fetch must not call it: pruning then would
 * wipe the children of a folder the server did not list.
 *
 * The fetched set is the normalized paths of `entries`. Rows are matched on
 * the same `parentPath` key `upsertDriveEntry` stores (parent of the child
 * path, not a share alias). When a returned entry's parent is not that key,
 * this refuses to prune: deleting against the wrong parent would wipe a
 * different folder.
 */
export async function applyFetchedDirectorySnapshot(
  username: string,
  parentPath: string,
  entries: readonly WgwDriveDirectoryEntry[],
): Promise<FetchedDirectorySnapshotResult> {
  await upsertDriveEntries(username, entries);
  return pruneDriveEntriesMissingFromFetch(username, parentPath, entries);
}

export async function pruneDriveEntriesMissingFromFetch(
  username: string,
  parentPath: string,
  entries: readonly WgwDriveDirectoryEntry[],
): Promise<FetchedDirectorySnapshotResult> {
  const normalizedParent = normalizeDriveEntryPath(parentPath);
  if (!fetchedEntriesBelongToParent(normalizedParent, entries)) {
    return { removedPaths: [], keptUnsavedPaths: [] };
  }

  const fetchedIds = new Set(entries.map((entry) => normalizeDriveEntryPath(entry.path)));
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const table = driveEntriesTable(db);
  const rows = await table.where("parentPath").equals(normalizedParent).toArray();
  const removedPaths: string[] = [];
  const keptUnsavedPaths: string[] = [];

  for (const row of rows) {
    if (fetchedIds.has(row.id)) continue;
    if (await documentHasPendingServerSave(row.id)) {
      keptUnsavedPaths.push(row.id);
      continue;
    }
    await table.delete(row.id);
    removedPaths.push(row.id);
    if (isDocsCollabEditablePath(row.id)) {
      await removeDocsAvailability(username, row.id);
      await dropCollabDatabase(row.id);
    }
  }

  if (keptUnsavedPaths.length > 0) {
    await rememberKeptUnsavedDocuments(username, keptUnsavedPaths);
    reportDocsSyncConflicts(keptUnsavedPaths);
    reportDriveSyncConflicts(keptUnsavedPaths);
  }

  return { removedPaths, keptUnsavedPaths };
}

export async function listKeptUnsavedDocumentPaths(username: string): Promise<string[]> {
  const raw = await readMeta(username, KEPT_UNSAVED_DOCUMENTS_META_KEY);
  const stored = parsePathList(raw);
  const stillKept: string[] = [];
  for (const path of stored) {
    if (await documentHasPendingServerSave(path)) stillKept.push(path);
  }
  if (stillKept.length !== stored.length) {
    await writeKeptUnsavedDocuments(username, stillKept);
  }
  return stillKept;
}

/**
 * True when every returned entry is a direct child of `normalizedParent`.
 * An empty listing is a successful empty folder, so it matches.
 */
export function fetchedEntriesBelongToParent(
  normalizedParent: string,
  entries: readonly { path: string }[],
): boolean {
  for (const entry of entries) {
    const id = normalizeDriveEntryPath(entry.path);
    const parent = normalizeDriveEntryPath(parentAndName(`/${id}`).destination);
    if (parent !== normalizedParent) return false;
  }
  return true;
}

async function rememberKeptUnsavedDocuments(
  username: string,
  paths: readonly string[],
): Promise<void> {
  const existing = parsePathList(await readMeta(username, KEPT_UNSAVED_DOCUMENTS_META_KEY));
  const merged = [...new Set([...existing, ...paths])];
  await writeKeptUnsavedDocuments(username, merged);
}

async function writeKeptUnsavedDocuments(
  username: string,
  paths: readonly string[],
): Promise<void> {
  await writeMeta(username, KEPT_UNSAVED_DOCUMENTS_META_KEY, JSON.stringify(paths));
}

function parsePathList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string" && item.length > 0);
  } catch {
    return [];
  }
}

async function documentHasPendingServerSave(apiPath: string): Promise<boolean> {
  const room = docsCollabRoomKey(normalizeDocsAvailabilityPath(apiPath));
  if (!room || !isDocsCollabEditablePath(room)) return false;
  const known = await listExistingDatabaseNames();
  const names = [docsCollabIndexedDbKey(room), ...docsCollabLegacyIndexedDbKeys(room)];
  const toOpen =
    known == null ? [docsCollabIndexedDbKey(room)] : names.filter((name) => known.has(name));
  for (const name of toOpen) {
    if (await indexedDbHasPendingSave(name)) return true;
  }
  return false;
}

async function dropCollabDatabase(apiPath: string): Promise<void> {
  const room = docsCollabRoomKey(normalizeDocsAvailabilityPath(apiPath));
  if (!room) return;
  await clearDocsCollabOfflinePersistence(room);
  const names = [docsCollabIndexedDbKey(room), ...docsCollabLegacyIndexedDbKeys(room)];
  await Promise.all(names.map(deleteIndexedDatabase));
}

async function indexedDbHasPendingSave(databaseName: string): Promise<boolean> {
  const ydoc = new Y.Doc();
  const persistence = new IndexeddbPersistence(databaseName, ydoc);
  try {
    await persistence.whenSynced;
    return Boolean(await persistence.get(PENDING_SERVER_SAVE_KEY));
  } catch {
    return false;
  } finally {
    await persistence.destroy();
    ydoc.destroy();
  }
}

async function listExistingDatabaseNames(): Promise<ReadonlySet<string> | null> {
  if (typeof indexedDB === "undefined" || typeof indexedDB.databases !== "function") return null;
  try {
    const rows = await indexedDB.databases();
    const names = new Set<string>();
    for (const row of rows) {
      if (row.name) names.add(row.name);
    }
    return names;
  } catch {
    return null;
  }
}

function deleteIndexedDatabase(databaseName: string): Promise<void> {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(databaseName);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}
