import { isDocsCollabEditablePath } from "@/docs-core/src/docs-collab-text-files";
import type { WgwDriveDirectoryEntry } from "@/lib/api/wgw/types";
import { parentAndName } from "@/lib/files/api-path";
import { readMeta, writeMeta } from "@/lib/offline/core/meta-store";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import { listOutboxMutations } from "@/lib/offline/core/outbox-store";
import type { OfflineOutboxRow } from "@/lib/offline/core/types";
import { removeDocsAvailability } from "@/lib/offline/docs/docs-availability-store";
import { DOCS_DOMAIN } from "@/lib/offline/docs/docs-schema";
import { reportDocsSyncConflicts } from "@/lib/offline/docs/docs-sync-conflicts";
import { removeDriveAvailability } from "@/lib/offline/drive/drive-availability-store";
import { removeDriveContentBlob } from "@/lib/offline/drive/drive-content-sync";
import {
  normalizeDriveEntryPath,
  removeDriveEntriesUnderPrefix,
  upsertDriveEntries,
} from "@/lib/offline/drive/drive-directory-offline-store";
import {
  DRIVE_DOMAIN,
  driveEntriesTable,
  type OfflineDriveEntryRow,
} from "@/lib/offline/drive/drive-schema";
import { reportDriveSyncConflicts } from "@/lib/offline/drive/drive-sync-conflicts";
import { nextPathAfterRename } from "@/lib/offline/shared/drive-sidecar-mutations";
import {
  collabIndexedDbHasPendingServerSave,
  docsCollabIndexedDbKey,
  docsCollabRoomKey,
  indexedDbNamesForRoom,
} from "@/text-editor-core/docs-collab/docs-collab-persistence";

/** Paths kept because `PENDING_SERVER_SAVE_KEY` is set. Both home notices read this. */
export const KEPT_UNSAVED_DOCUMENTS_META_KEY = "drive:kept-unsaved-documents";

export type FetchedDirectorySnapshotResult = {
  /** Child paths removed from `drive_entries`. */
  removedPaths: string[];
  /** Child paths left in place because they still have unsaved collab work. */
  keptUnsavedPaths: string[];
};

type OutboxPathPayload = {
  op?: string;
  from?: string;
  destination?: string;
  to?: string;
  cwd?: string;
  name?: string;
  path?: string;
  apiPath?: string;
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
 *
 * A cached row with an open Docs or Drive outbox mutation for that path is
 * left in place, including the path a rename or trash will land on. A removed
 * directory also drops nested rows, except descendants that are unsaved or
 * covered by an open outbox row.
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
  const allRows = await table.toArray();
  const existingDatabaseNames = await listExistingDatabaseNames();
  const protectedPaths = await openOutboxProtectedPaths(username);
  const removedPaths: string[] = [];
  const keptUnsavedPaths: string[] = [];

  for (const row of allRows) {
    if (row.parentPath !== normalizedParent || fetchedIds.has(row.id)) continue;
    await dropMissingRow(username, row, allRows, existingDatabaseNames, protectedPaths, {
      removedPaths,
      keptUnsavedPaths,
    });
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
  const existingDatabaseNames = await listExistingDatabaseNames();
  const stillKept: string[] = [];
  for (const path of stored) {
    if (await documentHasPendingServerSave(path, existingDatabaseNames)) stillKept.push(path);
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

type PruneBuckets = {
  removedPaths: string[];
  keptUnsavedPaths: string[];
};

async function dropMissingRow(
  username: string,
  row: OfflineDriveEntryRow,
  allRows: readonly OfflineDriveEntryRow[],
  existingDatabaseNames: ReadonlySet<string> | null,
  protectedPaths: ReadonlySet<string>,
  buckets: PruneBuckets,
): Promise<void> {
  if (isCoveredByOpenOutbox(row.id, protectedPaths)) return;
  if (await documentHasPendingServerSave(row.id, existingDatabaseNames)) {
    buckets.keptUnsavedPaths.push(row.id);
    return;
  }
  if (row.type === "dir") {
    await dropMissingDirectory(
      username,
      row,
      allRows,
      existingDatabaseNames,
      protectedPaths,
      buckets,
    );
    return;
  }
  if (await removePrunedFile(username, row.id)) buckets.removedPaths.push(row.id);
}

async function dropMissingDirectory(
  username: string,
  row: OfflineDriveEntryRow,
  allRows: readonly OfflineDriveEntryRow[],
  existingDatabaseNames: ReadonlySet<string> | null,
  protectedPaths: ReadonlySet<string>,
  buckets: PruneBuckets,
): Promise<void> {
  const descendants = allRows.filter((candidate) => candidate.id.startsWith(`${row.id}/`));
  const keepIds = new Set<string>();
  for (const descendant of descendants) {
    if (isCoveredByOpenOutbox(descendant.id, protectedPaths)) {
      keepIds.add(descendant.id);
      continue;
    }
    if (await documentHasPendingServerSave(descendant.id, existingDatabaseNames)) {
      buckets.keptUnsavedPaths.push(descendant.id);
      keepIds.add(descendant.id);
    }
  }

  for (const descendant of descendants) {
    if (descendant.type === "dir" || keepIds.has(descendant.id)) continue;
    if (await removePrunedFile(username, descendant.id)) {
      buckets.removedPaths.push(descendant.id);
    } else {
      keepIds.add(descendant.id);
    }
  }

  const removableDirs = descendants.filter(
    (descendant) => descendant.type === "dir" && !keepIds.has(descendant.id),
  );
  for (const descendant of removableDirs) {
    await removeDriveContentBlob(username, descendant.id);
    await removeDriveAvailability(username, descendant.id);
    buckets.removedPaths.push(descendant.id);
  }

  if (keepIds.size === 0) {
    await removeDriveEntriesUnderPrefix(username, row.id);
  } else {
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    const table = driveEntriesTable(db);
    await table.delete(row.id);
    for (const descendant of removableDirs) await table.delete(descendant.id);
  }

  await removeDriveContentBlob(username, row.id);
  await removeDriveAvailability(username, row.id);
  buckets.removedPaths.push(row.id);
}

/**
 * Drops the listing row, content blob, and drive availability pin.
 * A Docs path also drops its pin and collab database. Returns false when a
 * collab database delete is blocked or errors, and leaves that row in place.
 */
async function removePrunedFile(username: string, apiPath: string): Promise<boolean> {
  if (isDocsCollabEditablePath(apiPath)) {
    const deleted = await dropCollabDatabase(apiPath);
    if (!deleted) return false;
    await removeDocsAvailability(username, apiPath);
  }
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  await driveEntriesTable(db).delete(apiPath);
  await removeDriveContentBlob(username, apiPath);
  await removeDriveAvailability(username, apiPath);
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

async function documentHasPendingServerSave(
  apiPath: string,
  existingDatabaseNames: ReadonlySet<string> | null,
): Promise<boolean> {
  const room = docsCollabRoomKey(apiPath);
  if (!room || !isDocsCollabEditablePath(room)) return false;
  const names = indexedDbNamesForRoom(room);
  const toOpen =
    existingDatabaseNames == null
      ? [docsCollabIndexedDbKey(room)]
      : names.filter((name) => existingDatabaseNames.has(name));
  for (const name of toOpen) {
    if (await collabIndexedDbHasPendingServerSave(name)) return true;
  }
  return false;
}

async function dropCollabDatabase(apiPath: string): Promise<boolean> {
  const room = docsCollabRoomKey(apiPath);
  if (!room) return true;
  const results = await Promise.all(
    indexedDbNamesForRoom(room).map((name) => deleteIndexedDatabase(name)),
  );
  return results.every(Boolean);
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

function deleteIndexedDatabase(databaseName: string): Promise<boolean> {
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.deleteDatabase(databaseName);
    } catch {
      resolve(false);
      return;
    }
    request.onsuccess = () => resolve(true);
    request.onerror = () => resolve(false);
    request.onblocked = () => resolve(false);
  });
}

async function openOutboxProtectedPaths(username: string): Promise<Set<string>> {
  const rows = await listOutboxMutations(username);
  const paths = new Set<string>();
  for (const row of rows) {
    if (row.domain !== DRIVE_DOMAIN && row.domain !== DOCS_DOMAIN) continue;
    for (const path of protectedPathsFromOutboxRow(row)) {
      const id = normalizeDriveEntryPath(path);
      if (id) paths.add(id);
    }
  }
  return paths;
}

function protectedPathsFromOutboxRow(row: OfflineOutboxRow): string[] {
  let payload: OutboxPathPayload;
  try {
    payload = JSON.parse(row.payload) as OutboxPathPayload;
  } catch {
    return [];
  }
  if (payload.op === "upload" && payload.cwd && payload.name) {
    const parent = payload.cwd.replace(/\/+$/, "") || "/";
    return [parent === "/" ? `/${payload.name}` : `${parent}/${payload.name}`];
  }
  if (payload.op === "star" && payload.path) return [payload.path];
  if (payload.op === "create" && payload.apiPath) return [payload.apiPath];
  if ((payload.op === "rename" || payload.op === "trash") && payload.from) {
    const paths = [payload.from];
    if (payload.destination && payload.to) {
      paths.push(nextPathAfterRename(payload.from, payload.destination, payload.to));
    }
    return paths;
  }
  return [];
}

function isCoveredByOpenOutbox(id: string, protectedPaths: ReadonlySet<string>): boolean {
  if (protectedPaths.has(id)) return true;
  for (const path of protectedPaths) {
    if (id.startsWith(`${path}/`)) return true;
  }
  return false;
}
