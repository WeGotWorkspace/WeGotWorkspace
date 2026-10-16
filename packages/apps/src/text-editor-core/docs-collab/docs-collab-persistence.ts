import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import { isDocsCollabEditablePath } from "@/docs-core/src/docs-collab-text-files";
import { normalizeOfflinePath } from "@/lib/offline/core/offline-path";
import { readCachedDriveNodeId } from "@/lib/offline/drive/drive-directory-offline-store";
import { readOfflineDocsUsername, readOfflineDriveUsername } from "@/lib/offline/offline-session";
import { isYDocEmpty } from "./docs-collab-utils";
import { PENDING_SERVER_SAVE_KEY } from "./pending-server-save-key";

/** Notes and the path-key fallback. Do not bump this for Docs. */
export const DOCS_COLLAB_PATH_DB_VERSION = "v2";

/** Docs identity database. Notes does not use this suffix. */
export const DOCS_COLLAB_IDENTITY_DB_VERSION = "v3";

/** Stable y-indexeddb room key for a drive virtual path (no leading slash). */
export function docsCollabRoomKey(path: string): string {
  return normalizeOfflinePath(path);
}

/**
 * y-indexeddb database name for a collab room.
 * Docs passes a FileNode id and `v3`. Notes omits the version and stays on `v2`.
 * Local storage is keyed on document identity. Collab URLs and the signaling
 * room id stay on the path — do not move those onto nodeId.
 */
export function docsCollabIndexedDbKey(
  roomKey: string,
  version: string = DOCS_COLLAB_PATH_DB_VERSION,
): string {
  return `${roomKey}:${version}`;
}

/** Path-keyed `:v2` plus pre-v2 names for one document path. */
export function docsCollabPathKeyedSources(roomKey: string): string[] {
  return [
    docsCollabIndexedDbKey(roomKey, DOCS_COLLAB_PATH_DB_VERSION),
    ...docsCollabLegacyIndexedDbKeys(roomKey),
  ];
}

/** Pre-v2 IndexedDB room keys that may still hold pending-save metadata. */
export function docsCollabLegacyIndexedDbKeys(roomKey: string): string[] {
  const keys = [roomKey];
  const legacy = roomKey.startsWith("/") ? roomKey.slice(1) : `/${roomKey}`;
  if (legacy !== roomKey) keys.push(legacy);
  return keys;
}

/**
 * Moves an older database into the one just opened. A non-empty source body is
 * applied first when the target is still empty, then the pending-save flag.
 * When the target already has a body, that body stays authoritative. A source
 * body that still has unsynced pending edits stays where it is. A wiped source
 * body is skipped so an empty delete-set cannot replace the target document.
 * Docs passes path-keyed `:v2` plus pre-v2 names when opening `:v3`. The
 * default source list is the pre-v2 names only, which Notes and the path-key
 * fallback still use.
 */
export async function migrateDocsCollabPendingSaveFromLegacy(
  roomKey: string,
  targetPersistence: IndexeddbPersistence,
  sourceKeys: readonly string[] = docsCollabLegacyIndexedDbKeys(roomKey),
): Promise<void> {
  const targetDoc = targetPersistence.doc;
  if (!isYDocEmpty(targetDoc) && (await targetPersistence.get(PENDING_SERVER_SAVE_KEY))) return;

  let pending = false;
  const legacyKeysToClear: string[] = [];
  for (const legacyKey of sourceKeys) {
    if (legacyKey === targetPersistence.name) continue;
    const legacy = await withRawIndexedDbPersistence(legacyKey, async (persistence) => {
      const empty = isYDocEmpty(persistence.doc);
      return {
        update: empty ? null : Y.encodeStateAsUpdate(persistence.doc),
        pending: Boolean(await persistence.get(PENDING_SERVER_SAVE_KEY)),
      };
    });
    if (!legacy || (!legacy.update && !legacy.pending)) continue;
    let applied = false;
    if (legacy.update && isYDocEmpty(targetDoc)) {
      Y.applyUpdate(targetDoc, legacy.update);
      applied = true;
    }
    if (legacy.pending && legacy.update && !applied) {
      // Unsynced legacy edits we cannot merge safely: keep that database and its flag.
      console.warn("[docs-collab] kept legacy room with unsynced edits", { legacyKey });
      continue;
    }
    if (legacy.pending) pending = true;
    legacyKeysToClear.push(legacyKey);
  }

  if (pending && !(await targetPersistence.get(PENDING_SERVER_SAVE_KEY))) {
    await targetPersistence.set(PENDING_SERVER_SAVE_KEY, 1);
  }

  for (const legacyKey of legacyKeysToClear) {
    await clearIndexedDbRoom(legacyKey);
  }
}

async function withRawIndexedDbPersistence<T>(
  indexedDbName: string,
  run: (persistence: IndexeddbPersistence) => Promise<T>,
): Promise<T | undefined> {
  const ydoc = new Y.Doc();
  const persistence = new IndexeddbPersistence(indexedDbName, ydoc);
  try {
    await persistence.whenSynced;
    return await run(persistence);
  } catch {
    return undefined;
  } finally {
    await persistence.destroy();
    ydoc.destroy();
  }
}

async function cachedNodeIdForRoom(roomKey: string): Promise<string | undefined> {
  const username = readOfflineDriveUsername() ?? readOfflineDocsUsername();
  if (!username || !roomKey) return undefined;
  return readCachedDriveNodeId(username, roomKey);
}

export type DocsCollabDatabaseChoice = {
  name: string;
  room: string;
  nodeId: string | undefined;
};

/**
 * Resolve the FileNode id before IndexedDB opens.
 * An unknown id (no crawl yet, or a deeplink) uses the path-keyed `:v2` database.
 */
export async function resolveDocsCollabDatabase(
  apiPath: string,
): Promise<DocsCollabDatabaseChoice> {
  const room = docsCollabRoomKey(apiPath);
  const nodeId = await cachedNodeIdForRoom(room);
  if (!nodeId) {
    console.warn("[docs-collab] nodeId unknown, opening path-keyed database", { room });
    return {
      name: docsCollabIndexedDbKey(room, DOCS_COLLAB_PATH_DB_VERSION),
      room,
      nodeId: undefined,
    };
  }
  return {
    name: docsCollabIndexedDbKey(nodeId, DOCS_COLLAB_IDENTITY_DB_VERSION),
    room,
    nodeId,
  };
}

/** Identity database first when the cache knows it, then path `:v2` and pre-v2 names. */
export async function docsCollabReadNames(roomKey: string): Promise<string[]> {
  const nodeId = await cachedNodeIdForRoom(roomKey);
  const names: string[] = [];
  if (nodeId) {
    names.push(docsCollabIndexedDbKey(nodeId, DOCS_COLLAB_IDENTITY_DB_VERSION));
  }
  names.push(docsCollabIndexedDbKey(roomKey, DOCS_COLLAB_PATH_DB_VERSION));
  const slash = roomKey.startsWith("/") ? roomKey.slice(1) : `/${roomKey}`;
  if (slash !== roomKey) {
    names.push(docsCollabIndexedDbKey(slash, DOCS_COLLAB_PATH_DB_VERSION));
  }
  names.push(...docsCollabLegacyIndexedDbKeys(roomKey));
  return names;
}

async function clearIndexedDbRoom(indexedDbName: string): Promise<void> {
  await withRawIndexedDbPersistence(indexedDbName, async (persistence) => {
    await persistence.clearData();
  });
}

async function persistenceHasPendingSave(roomKey: string): Promise<boolean> {
  for (const name of await docsCollabReadNames(roomKey)) {
    const pending = await withRawIndexedDbPersistence(name, (persistence) =>
      persistence.get(PENDING_SERVER_SAVE_KEY),
    );
    if (pending) return true;
  }
  return false;
}

async function clearPendingSaveInRoom(roomKey: string): Promise<void> {
  for (const name of await docsCollabReadNames(roomKey)) {
    await withRawIndexedDbPersistence(name, async (persistence) => {
      await persistence.del(PENDING_SERVER_SAVE_KEY);
    });
  }
}

/** Whether a collab room has a deferred server save recorded in y-indexeddb. */
export async function hasDocsCollabPendingServerSave(
  apiPath: string | null | undefined,
): Promise<boolean> {
  const room = docsCollabRoomKey(apiPath ?? "");
  if (!room || !isDocsCollabEditablePath(room)) return false;

  return persistenceHasPendingSave(room);
}

/** Clears deferred server-save metadata for a collab room in y-indexeddb. */
export async function clearDocsCollabPendingServerSave(
  apiPath: string | null | undefined,
): Promise<void> {
  const room = docsCollabRoomKey(apiPath ?? "");
  if (!room || !isDocsCollabEditablePath(room)) return;

  await clearPendingSaveInRoom(room);
}

export type DocsCollabOfflinePersistenceSnapshot = {
  yjsUpdate: Uint8Array;
  pendingServerSave: boolean;
};

async function captureIndexedDbPersistence(
  indexedDbName: string,
): Promise<DocsCollabOfflinePersistenceSnapshot | undefined> {
  const ydoc = new Y.Doc();
  const persistence = new IndexeddbPersistence(indexedDbName, ydoc);
  try {
    await persistence.whenSynced;
    const yjsUpdate = Y.encodeStateAsUpdate(ydoc);
    if (yjsUpdate.length === 0) return undefined;
    const pendingServerSave = Boolean(await persistence.get(PENDING_SERVER_SAVE_KEY));
    return { yjsUpdate, pendingServerSave };
  } finally {
    await persistence.destroy();
    ydoc.destroy();
  }
}

async function captureRoomPersistence(
  roomKey: string,
): Promise<DocsCollabOfflinePersistenceSnapshot | undefined> {
  for (const name of await docsCollabReadNames(roomKey)) {
    const snapshot = await captureIndexedDbPersistence(name);
    if (snapshot) return snapshot;
  }
  return undefined;
}

/** Captures y-indexeddb collab state before offline trash side effects clear it. */
export async function captureDocsCollabOfflinePersistence(
  apiPath: string,
): Promise<DocsCollabOfflinePersistenceSnapshot | undefined> {
  const room = docsCollabRoomKey(apiPath);
  if (!room || !isDocsCollabEditablePath(room)) return undefined;

  return captureRoomPersistence(room);
}

/** Restores y-indexeddb collab state captured before offline trash. */
export async function restoreDocsCollabOfflinePersistence(
  apiPath: string,
  snapshot: DocsCollabOfflinePersistenceSnapshot,
): Promise<void> {
  const room = docsCollabRoomKey(apiPath);
  if (!room || !isDocsCollabEditablePath(room)) return;

  const choice = await resolveDocsCollabDatabase(apiPath);
  const ydoc = new Y.Doc();
  const persistence = new IndexeddbPersistence(choice.name, ydoc);
  try {
    await persistence.whenSynced;
    if (snapshot.yjsUpdate.length > 0) {
      Y.applyUpdate(ydoc, snapshot.yjsUpdate);
    }
    if (snapshot.pendingServerSave) {
      await persistence.set(PENDING_SERVER_SAVE_KEY, 1);
    } else {
      await persistence.del(PENDING_SERVER_SAVE_KEY);
    }
  } finally {
    await persistence.destroy();
    ydoc.destroy();
  }
}

/** Clears y-indexeddb persistence for a collab room (e.g. remove offline copy). */
export async function clearDocsCollabOfflinePersistence(apiPath: string): Promise<void> {
  const room = docsCollabRoomKey(apiPath);
  for (const name of await docsCollabReadNames(room)) {
    await clearIndexedDbRoom(name);
  }
}

/** Path-keyed names a room may still occupy: the `:v2` key and pre-v2 keys. */
export function indexedDbNamesForRoom(roomKey: string): string[] {
  return [docsCollabIndexedDbKey(roomKey), ...docsCollabLegacyIndexedDbKeys(roomKey)];
}

/**
 * Databases that already exist. `null` when `indexedDB.databases` is missing
 * or rejects; callers then open a name without an existence check.
 */
export async function listExistingIndexedDatabaseNames(): Promise<ReadonlySet<string> | null> {
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

/**
 * True when this y-indexeddb database has `PENDING_SERVER_SAVE_KEY`.
 * Shared by Docs prune and Notes. Logout wipe reads the `custom` store
 * directly instead, so a stuck sync cannot hang sign-out.
 */
export async function collabIndexedDbHasPendingServerSave(databaseName: string): Promise<boolean> {
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

/**
 * Copies one y-indexeddb database onto another and clears the source.
 * An empty source with no pending save is left untouched.
 */
async function moveIndexedDbPersistence(fromName: string, toName: string): Promise<void> {
  if (fromName === toName) return;
  const oldDoc = new Y.Doc();
  const oldPersistence = new IndexeddbPersistence(fromName, oldDoc);
  try {
    await oldPersistence.whenSynced;
    const pendingServerSave = Boolean(await oldPersistence.get(PENDING_SERVER_SAVE_KEY));
    const hasBody = !isYDocEmpty(oldDoc);
    if (!hasBody && !pendingServerSave) return;

    const update = hasBody ? Y.encodeStateAsUpdate(oldDoc) : null;
    const newDoc = new Y.Doc();
    const newPersistence = new IndexeddbPersistence(toName, newDoc);
    try {
      await newPersistence.whenSynced;
      if (update) Y.applyUpdate(newDoc, update);
      if (pendingServerSave) await newPersistence.set(PENDING_SERVER_SAVE_KEY, 1);
    } finally {
      await newPersistence.destroy();
      newDoc.destroy();
    }
    await oldPersistence.clearData();
  } finally {
    await oldPersistence.destroy();
    oldDoc.destroy();
  }
}

/**
 * Copies a Notes y-indexeddb database when an offline-created UID is remapped
 * to the server UID. Docs path changes do not call this: the database name is
 * the FileNode id, and the room id stays the path.
 */
export async function migrateCollabPersistence(oldPath: string, newPath: string): Promise<void> {
  if (oldPath === newPath) {
    throw new Error("migrateCollabPersistence requires distinct old and new paths");
  }

  const oldNames = indexedDbNamesForRoom(docsCollabRoomKey(oldPath));
  const newNames = indexedDbNamesForRoom(docsCollabRoomKey(newPath));
  for (let index = 0; index < oldNames.length; index += 1) {
    const fromName = oldNames[index];
    const toName = newNames[index];
    if (!fromName || !toName) continue;
    await moveIndexedDbPersistence(fromName, toName);
  }
}
