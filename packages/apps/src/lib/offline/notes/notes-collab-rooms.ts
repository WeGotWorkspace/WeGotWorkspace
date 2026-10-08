import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import { PENDING_SERVER_SAVE_KEY } from "@/text-editor-core/docs-collab/use-docs-collab-save";
import {
  docsCollabIndexedDbKey,
  docsCollabRoomKey,
  migrateCollabPersistence,
} from "@/text-editor-core/docs-collab/docs-collab-persistence";
import {
  applyContentSeedToYDoc,
  readContentFromYDoc,
} from "@/text-editor-core/docs-collab/docs-collab-editor-surface";
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

/**
 * Databases that already exist. `null` when `indexedDB.databases` is missing;
 * callers then open the legacy name without an existence check.
 */
export async function listExistingNoteCollabDatabaseNames(): Promise<ReadonlySet<string> | null> {
  if (typeof indexedDB === "undefined" || typeof indexedDB.databases !== "function") return null;
  const rows = await indexedDB.databases();
  const names = new Set<string>();
  for (const row of rows) {
    if (row.name) names.add(row.name);
  }
  return names;
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
      ? await listExistingNoteCollabDatabaseNames()
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
  const known = await listExistingNoteCollabDatabaseNames();
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
  const result = await firstFromRoomNames(
    uid,
    async (_d, p) => ((await p.get(PENDING_SERVER_SAVE_KEY)) ? true : null),
    existingDatabaseNames,
  );
  return Boolean(result);
}

/** Replace the UID-keyed Y.Doc with server markdown (Decision 6 “Use theirs”). */
export async function writeNoteCollabOfflineContent(uid: string, markdown: string): Promise<void> {
  const room = noteCollabRoomKey(uid);
  if (!room) return;
  await withIndexedDb(docsCollabIndexedDbKey(room), async (ydoc, persistence) => {
    const fragment = ydoc.getXmlFragment("default");
    ydoc.transact(() => {
      if (fragment.length > 0) fragment.delete(0, fragment.length);
    });
    applyContentSeedToYDoc(ydoc, markdown, "markdown");
    await persistence.del(PENDING_SERVER_SAVE_KEY);
  });
  const known = await listExistingNoteCollabDatabaseNames();
  for (const name of legacyNamesToOpen(room, known)) {
    await withIndexedDb(name, async (_ydoc, persistence) => {
      await persistence.clearData();
    });
  }
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
