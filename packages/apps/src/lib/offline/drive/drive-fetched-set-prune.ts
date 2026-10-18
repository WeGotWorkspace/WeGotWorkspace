import { isDocsCollabEditablePath } from "@/docs-core/src/docs-collab-text-files";
import type { WgwDriveDirectoryEntry } from "@/lib/api/wgw/types";
import { parentAndName } from "@/lib/files/api-path";
import { readMeta, writeMeta } from "@/lib/offline/core/meta-store";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import { listOutboxMutations } from "@/lib/offline/core/outbox-store";
import { removeDocsAvailability } from "@/lib/offline/docs/docs-availability-store";
import { DOCS_DOMAIN } from "@/lib/offline/docs/docs-schema";
import { pathsForDocsOutboxRow } from "@/lib/offline/docs/docs-outbox-flush";
import { reportDocsSyncConflicts } from "@/lib/offline/docs/docs-sync-conflicts";
import { removeDriveAvailability } from "@/lib/offline/drive/drive-availability-store";
import { removeDriveContentBlob } from "@/lib/offline/drive/drive-content-sync";
import {
  normalizeDriveEntryPath,
  removeDriveEntriesUnderPrefix,
  upsertDriveEntries,
} from "@/lib/offline/drive/drive-directory-offline-store";
import { pathsForDriveOutboxRow } from "@/lib/offline/drive/drive-outbox-flush";
import {
  DRIVE_DOMAIN,
  driveEntriesTable,
  type OfflineDriveEntryRow,
} from "@/lib/offline/drive/drive-schema";
import { reportDriveSyncConflicts } from "@/lib/offline/drive/drive-sync-conflicts";
import {
  collabIndexedDbHasPendingServerSave,
  DOCS_COLLAB_IDENTITY_DB_VERSION,
  docsCollabIndexedDbKey,
  docsCollabRoomKey,
  indexedDbNamesForRoom,
  listExistingIndexedDatabaseNames,
} from "@/text-editor-core/docs-collab/docs-collab-persistence";
import type { EntityTable } from "dexie";

/** Paths kept because `PENDING_SERVER_SAVE_KEY` is set. Both home notices read this. */
export const KEPT_UNSAVED_DOCUMENTS_META_KEY = "drive:kept-unsaved-documents";

export type FetchedDirectorySnapshotResult = {
  /** Child paths removed from `drive_entries`. */
  removedPaths: string[];
  /** Child paths left in place because they still have unsaved collab work. */
  keptUnsavedPaths: string[];
};

type DriveEntries = EntityTable<OfflineDriveEntryRow, "id">;

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
 * directory also drops nested rows, except descendants that are unsaved,
 * covered by an open outbox row, or blocked on collab-database delete. Those
 * rows keep their ancestor directories up to the pruned folder so the file
 * stays reachable.
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
  const missing = rows.filter((row) => !fetchedIds.has(row.id));
  if (missing.length === 0) return { removedPaths, keptUnsavedPaths };

  const protectedPaths = await openOutboxProtectedPaths(username);
  let databaseNames: ReadonlySet<string> | null | undefined;
  const namesForPendingSave = async (): Promise<ReadonlySet<string> | null> => {
    if (databaseNames === undefined) databaseNames = await listExistingIndexedDatabaseNames();
    return databaseNames;
  };
  const buckets: PruneBuckets = { removedPaths, keptUnsavedPaths };

  for (const row of missing) {
    await dropMissingRow(username, row, table, namesForPendingSave, protectedPaths, buckets);
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
  if (stored.length === 0) return [];
  const existingDatabaseNames = await listExistingIndexedDatabaseNames();
  const table = driveEntriesTable(offlineDbForAccount(offlineAccountKeyFromUsername(username)));
  const stillKept: string[] = [];
  for (const path of stored) {
    const row = (await table.get(path)) ?? { id: path };
    if (await documentHasPendingServerSave(row, table, async () => existingDatabaseNames)) {
      stillKept.push(path);
    }
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

type DatabaseNames = () => Promise<ReadonlySet<string> | null>;

type PrunedRow = Pick<OfflineDriveEntryRow, "id" | "nodeId">;

async function dropMissingRow(
  username: string,
  row: OfflineDriveEntryRow,
  table: DriveEntries,
  databaseNames: DatabaseNames,
  protectedPaths: ReadonlySet<string>,
  buckets: PruneBuckets,
): Promise<void> {
  if (isCoveredByOpenOutbox(row.id, protectedPaths)) return;
  if (await documentHasPendingServerSave(row, table, databaseNames)) {
    buckets.keptUnsavedPaths.push(row.id);
    return;
  }
  if (row.type === "dir") {
    await dropMissingDirectory(username, row, table, databaseNames, protectedPaths, buckets);
    return;
  }
  if (await removePrunedFile(username, row, table)) buckets.removedPaths.push(row.id);
}

async function dropMissingDirectory(
  username: string,
  row: OfflineDriveEntryRow,
  table: DriveEntries,
  databaseNames: DatabaseNames,
  protectedPaths: ReadonlySet<string>,
  buckets: PruneBuckets,
): Promise<void> {
  const descendants = await table.where("id").startsWith(`${row.id}/`).toArray();
  const keepIds = new Set<string>();
  for (const descendant of descendants) {
    if (isCoveredByOpenOutbox(descendant.id, protectedPaths)) {
      keepWithAncestors(keepIds, descendant.id, row.id);
      continue;
    }
    if (await documentHasPendingServerSave(descendant, table, databaseNames)) {
      buckets.keptUnsavedPaths.push(descendant.id);
      keepWithAncestors(keepIds, descendant.id, row.id);
    }
  }

  for (const descendant of descendants) {
    if (descendant.type === "dir" || keepIds.has(descendant.id)) continue;
    if (await removePrunedFile(username, descendant, table)) {
      buckets.removedPaths.push(descendant.id);
    } else {
      keepWithAncestors(keepIds, descendant.id, row.id);
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

  const rootKept = keepIds.has(row.id);
  if (keepIds.size === 0) {
    await removeDriveEntriesUnderPrefix(username, row.id);
  } else {
    for (const descendant of removableDirs) await table.delete(descendant.id);
    if (!rootKept) await table.delete(row.id);
  }

  if (!rootKept) {
    await removeDriveContentBlob(username, row.id);
    await removeDriveAvailability(username, row.id);
    buckets.removedPaths.push(row.id);
  }
}

/** Keep `id` and each directory from its parent up through `rootId`. */
function keepWithAncestors(keepIds: Set<string>, id: string, rootId: string): void {
  keepIds.add(id);
  let current = parentId(id);
  while (current.length > 0 && (current === rootId || current.startsWith(`${rootId}/`))) {
    keepIds.add(current);
    if (current === rootId) break;
    current = parentId(current);
  }
}

function parentId(id: string): string {
  const slash = id.lastIndexOf("/");
  return slash <= 0 ? "" : id.slice(0, slash);
}

/**
 * Drops the listing row, content blob, and drive availability pin.
 * A Docs path also drops its pin and collab database. Returns false when a
 * collab database delete is blocked or errors, and leaves that row in place.
 */
async function removePrunedFile(
  username: string,
  row: PrunedRow,
  table: DriveEntries,
): Promise<boolean> {
  const apiPath = row.id;
  if (isDocsCollabEditablePath(apiPath)) {
    const deleted = await dropCollabDatabase(apiPath, await identityDatabaseFor(row, table));
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

/**
 * `{nodeId}:v3` of a pruned row, or null. When another cached row carries the
 * same id, the document was renamed or moved: its database belongs to that
 * path now, so the pruned row neither keeps nor drops it.
 */
async function identityDatabaseFor(row: PrunedRow, table: DriveEntries): Promise<string | null> {
  if (!row.nodeId) return null;
  const owners = await table.where("nodeId").equals(row.nodeId).primaryKeys();
  if (owners.some((id) => id !== row.id)) return null;
  return docsCollabIndexedDbKey(row.nodeId, DOCS_COLLAB_IDENTITY_DB_VERSION);
}

async function documentHasPendingServerSave(
  row: PrunedRow,
  table: DriveEntries,
  databaseNames: DatabaseNames,
): Promise<boolean> {
  const room = docsCollabRoomKey(row.id);
  if (!room || !isDocsCollabEditablePath(room)) return false;
  const known = await databaseNames();
  const identity = await identityDatabaseFor(row, table);
  const names = identity ? [identity, ...indexedDbNamesForRoom(room)] : indexedDbNamesForRoom(room);
  const toOpen =
    known == null
      ? [...(identity ? [identity] : []), docsCollabIndexedDbKey(room)]
      : names.filter((name) => known.has(name));
  for (const name of toOpen) {
    if (await collabIndexedDbHasPendingServerSave(name)) return true;
  }
  return false;
}

async function dropCollabDatabase(apiPath: string, identity: string | null): Promise<boolean> {
  const room = docsCollabRoomKey(apiPath);
  if (!room) return true;
  const names = identity ? [identity, ...indexedDbNamesForRoom(room)] : indexedDbNamesForRoom(room);
  const results = await Promise.all(names.map((name) => deleteIndexedDatabase(name)));
  return results.every(Boolean);
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
    const listed =
      row.domain === DRIVE_DOMAIN
        ? pathsForDriveOutboxRow(row)
        : row.domain === DOCS_DOMAIN
          ? pathsForDocsOutboxRow(row)
          : [];
    for (const path of listed) {
      const id = normalizeDriveEntryPath(path);
      if (id) paths.add(id);
    }
  }
  return paths;
}

/** True when `id` or one of its ancestor directories is an open outbox path. */
function isCoveredByOpenOutbox(id: string, protectedPaths: ReadonlySet<string>): boolean {
  let current = id;
  while (current.length > 0) {
    if (protectedPaths.has(current)) return true;
    const slash = current.lastIndexOf("/");
    if (slash <= 0) return false;
    current = current.slice(0, slash);
  }
  return false;
}
