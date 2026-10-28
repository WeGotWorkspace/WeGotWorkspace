import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import { readContentFromYDoc } from "@/text-editor-core/docs-collab/docs-collab-editor-surface";
import {
  collabIndexedDbHasPendingServerSave,
  docsCollabIndexedDbKey,
  docsCollabRoomKey,
  listExistingIndexedDatabaseNames,
  migrateCollabPersistence,
} from "@/text-editor-core/docs-collab/docs-collab-persistence";
import { isYDocEmpty } from "@/text-editor-core/docs-collab/docs-collab-utils";

/** y-indexeddb room key = VJOURNAL UID (never a Drive `.notes` path). */
export function noteCollabRoomKey(uid: string): string {
  return docsCollabRoomKey(uid);
}

/**
 * Pre-v2 name for a note. `noteCollabRoomKey` strips slashes, so `/uid` was never stored.
 */
function noteCollabLegacyIndexedDbKeys(room: string): string[] {
  return [room];
}

function legacyNamesToOpen(
  room: string,
  existingDatabaseNames: ReadonlySet<string> | null,
): string[] {
  const names = noteCollabLegacyIndexedDbKeys(room);
  if (existingDatabaseNames == null) return names;
  return names.filter((name) => existingDatabaseNames.has(name));
}

async function withIndexedDb<T>(
  indexedDbName: string,
  run: (ydoc: Y.Doc, persistence: IndexeddbPersistence) => Promise<T>,
): Promise<T | undefined> {
  const ydoc = new Y.Doc();
  const persistence = new IndexeddbPersistence(indexedDbName, ydoc);
  try {
    await persistence.whenSynced;
    return await run(ydoc, persistence);
  } catch {
    return undefined;
  } finally {
    await persistence.destroy();
    ydoc.destroy();
  }
}

/** The `:v2` database first, then pre-v2 names; the first one that `pick` accepts wins. */
async function firstFromRoomNames<T>(
  uid: string,
  pick: (ydoc: Y.Doc, persistence: IndexeddbPersistence) => Promise<T | null | undefined>,
  existingDatabaseNames?: ReadonlySet<string> | null,
): Promise<T | null> {
  const room = noteCollabRoomKey(uid);
  if (!room) return null;
  const known =
    existingDatabaseNames === undefined
      ? await listExistingIndexedDatabaseNames()
      : existingDatabaseNames;
  const names = [docsCollabIndexedDbKey(room), ...legacyNamesToOpen(room, known)];
  for (const name of names) {
    const value = await withIndexedDb(name, pick);
    if (value != null) return value;
  }
  return null;
}

/** Headlessly read markdown from the UID-keyed collab crash buffer. */
export async function readNoteCollabOfflineContent(uid: string): Promise<string | null> {
  return firstFromRoomNames(uid, async (ydoc) => {
    if (isYDocEmpty(ydoc)) return null;
    return readContentFromYDoc(ydoc, "markdown");
  });
}

export async function hasNoteCollabOfflinePersistence(uid: string): Promise<boolean> {
  const room = noteCollabRoomKey(uid);
  if (!room) return false;
  const known = await listExistingIndexedDatabaseNames();
  const names = [docsCollabIndexedDbKey(room), ...legacyNamesToOpen(room, known)];
  for (const name of names) {
    const found = await withIndexedDb(name, async (ydoc) => !isYDocEmpty(ydoc));
    if (found) return true;
  }
  return false;
}

export async function hasNoteCollabPendingServerSave(
  uid: string,
  existingDatabaseNames?: ReadonlySet<string> | null,
): Promise<boolean> {
  const room = noteCollabRoomKey(uid);
  if (!room) return false;
  const known =
    existingDatabaseNames === undefined
      ? await listExistingIndexedDatabaseNames()
      : existingDatabaseNames;
  for (const name of pendingSaveNamesToOpen(room, known)) {
    if (await collabIndexedDbHasPendingServerSave(name)) return true;
  }
  return false;
}

/**
 * A missing database cannot hold a pending save, and opening one creates it.
 * With a listing, open only names that exist (most notes were never opened on
 * this device, #1714). Without one, open the `:v2` name as before.
 */
function pendingSaveNamesToOpen(
  room: string,
  existingDatabaseNames: ReadonlySet<string> | null,
): string[] {
  const names = [docsCollabIndexedDbKey(room), ...legacyNamesToOpen(room, existingDatabaseNames)];
  if (existingDatabaseNames == null) return names;
  return names.filter((name) => existingDatabaseNames.has(name));
}

/** Move the UID-keyed crash buffer after an offline create remaps to a server UID. */
export async function migrateNoteCollabRoom(oldUid: string, newUid: string): Promise<void> {
  const from = noteCollabRoomKey(oldUid);
  const to = noteCollabRoomKey(newUid);
  if (!from || !to || from === to) return;
  const hasOld = await hasNoteCollabOfflinePersistence(oldUid);
  if (!hasOld) return;
  await migrateCollabPersistence(from, to);
}

/**
 * Archive won over unsaved body edits (#1535): forget the local copy, so a
 * restore later starts from the server. An open editor holds the database;
 * the delete waits until that editor closes.
 */
export async function discardNoteCollabBuffer(uid: string): Promise<void> {
  const room = noteCollabRoomKey(uid);
  if (!room || typeof indexedDB === "undefined") return;
  const known = await listExistingIndexedDatabaseNames();
  const names = [docsCollabIndexedDbKey(room), ...legacyNamesToOpen(room, known)];
  for (const name of names) {
    if (known && !known.has(name)) continue;
    try {
      indexedDB.deleteDatabase(name);
    } catch {
      // A browser that refuses the delete keeps the buffer; it is not uploaded.
    }
  }
}
