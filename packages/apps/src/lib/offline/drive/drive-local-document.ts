import { isDocsCollabEditablePath } from "@/docs-core/src/docs-collab-text-files";
import { readMeta, writeMeta } from "@/lib/offline/core/meta-store";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import {
  normalizeDocsAvailabilityPath,
  removeDocsAvailability,
} from "@/lib/offline/docs/docs-availability-store";
import { driveEntriesTable } from "@/lib/offline/drive/drive-schema";
import {
  clearDocsCollabOfflinePersistence,
  docsCollabIndexedDbKey,
  docsCollabLegacyIndexedDbKeys,
  docsCollabRoomKey,
} from "@/text-editor-core/docs-collab/docs-collab-persistence";
import { PENDING_SERVER_SAVE_KEY } from "@/text-editor-core/docs-collab/pending-server-save-key";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";

/** Paths kept because `PENDING_SERVER_SAVE_KEY` is set. */
export const KEPT_UNSAVED_DOCUMENTS_META_KEY = "drive:kept-unsaved-documents";

/**
 * Keep the drive row, pin, and collab database when the document still has
 * unsaved local work. Otherwise drop the pin and the database. The caller
 * deletes the drive row only after `"dropped"`.
 */
export async function retainOrDropLocalDocument(
  username: string,
  apiPath: string,
): Promise<"kept" | "dropped"> {
  const id = normalizeDocsAvailabilityPath(apiPath);
  if (await documentHasPendingServerSave(id)) {
    await rememberKeptUnsavedDocuments(username, [id]);
    return "kept";
  }
  if (isDocsCollabEditablePath(id)) {
    await removeDocsAvailability(username, id);
    await dropCollabDatabase(id);
  }
  return "dropped";
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

export async function documentHasPendingServerSave(apiPath: string): Promise<boolean> {
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

export async function deleteDriveEntryByPath(username: string, apiPath: string): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  await driveEntriesTable(db).delete(normalizeDocsAvailabilityPath(apiPath));
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
