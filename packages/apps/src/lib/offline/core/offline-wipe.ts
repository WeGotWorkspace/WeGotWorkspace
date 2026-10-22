import { appendLogoutStepFailure } from "@/lib/api/wgw/session-debug";
import { PENDING_SERVER_SAVE_KEY } from "@/text-editor-core/docs-collab/pending-server-save-key";

const OFFLINE_DB_PREFIX = "wgw-offline-";
const OFFLINE_STORAGE_PREFIX = "wgw.offline.";
const OFFLINE_USERNAME_SUFFIX = ".username";
/** Notes and the Docs path-key fallback. Nothing else on this origin uses it. */
const COLLAB_DB_SUFFIX = ":v2";
/** Docs identity database (`nodeId` + `:v3`). Notes does not use this suffix. */
const DOCS_IDENTITY_DB_SUFFIX = ":v3";
const DRIVE_ENTRIES_STORE = "drive_entries";
const NOTES_STORE = "notes_notes";
const DOCS_STORE = "docs_availability";
const OUTBOX_STORE = "outbox";
/**
 * y-indexeddb object store for custom values. The logout test writes
 * `PENDING_SERVER_SAVE_KEY` through `IndexeddbPersistence.set`, so a rename
 * of this store fails that test instead of returning a silent zero.
 */
const COLLAB_CUSTOM_STORE = "custom";
const INDEXED_DB_STEP_TIMEOUT_MS = 2_000;

type AuthorizedFetch = (path: string, init?: RequestInit) => Promise<Response>;
type AccountKeyFromUsername = (username: string) => string;

/** Run one logout step without letting its failure skip the remaining steps. */
export async function runLogoutStep(step: () => Promise<void>, label: string): Promise<void> {
  try {
    await step();
  } catch (error) {
    appendLogoutStepFailure(label, error);
  }
}

/**
 * Delete the server push row, then drop the browser subscription.
 * `navigator.serviceWorker.ready` never settles when no worker is registered,
 * which would block the rest of logout, so this uses `getRegistration()`.
 */
export async function releasePushOnLogout(authorizedFetch: AuthorizedFetch): Promise<void> {
  const subscription = await currentPushSubscription();
  if (!subscription) return;
  const endpoint = subscription.endpoint.trim();
  if (endpoint) {
    try {
      await deleteServerPushSubscription(authorizedFetch, endpoint);
    } catch (error) {
      await subscription.unsubscribe().catch(() => undefined);
      throw error;
    }
  }
  await subscription.unsubscribe();
}

/**
 * Close and delete every offline account database, every note and document
 * collab room, and the remembered usernames. The account database includes the
 * outbox and every collab room, including document and note bodies that were
 * never saved. The logout screen counts that work and asks before it calls this.
 */
export async function wipeOfflineAccountData(): Promise<void> {
  const Dexie = (await import("dexie")).default;
  const { resetOfflineDatabaseCache } = await import("@/lib/offline/core/offline-db");
  // Sign-out wipes the upload queue too; stop uploading before its database goes away.
  const { stopAllDriveUploaders } = await import("@/lib/offline/drive/upload/drive-upload-runner");
  stopAllDriveUploaders();
  const names = await databasesToWipe();
  resetOfflineDatabaseCache();
  let failure: unknown = null;
  for (const name of names) {
    try {
      await Dexie.delete(name);
    } catch (error) {
      failure = error;
    }
  }
  removeOfflineLocalStorageKeys();
  if (failure) throw failure;
}

/**
 * Unsynced work the next logout wipe discards, on every account database on
 * this device. The wipe deletes all of them, so the number is device-wide:
 * outbox rows plus collab rooms that still hold an unsaved body.
 */
export async function countDiscardedUnsyncedChanges(): Promise<number> {
  const targets = await collectWipeTargets();
  let total = 0;
  for (const name of targets.accountNames) {
    total += await countObjectStore(name, OUTBOX_STORE);
  }
  total += await countPendingCollabRooms(collabNamesToCount(targets));
  return total;
}

/**
 * `addCollabNames` adds `room`, `/room`, and `room:v2` for every cached note.
 * Opening a missing name creates a database, so when `indexedDB.databases()`
 * returned a listing the count only opens names that are actually there.
 * Without a listing, the derived names are still opened.
 */
function collabNamesToCount(targets: WipeTargets): string[] {
  if (!targets.listedNames) return targets.collabNames;
  const present = new Set(targets.listedNames);
  return targets.collabNames.filter((name) => present.has(name));
}

async function currentPushSubscription(): Promise<PushSubscription | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return null;
  return registration.pushManager.getSubscription();
}

/**
 * Inlined from `unsubscribePush` in `notifications.ts`. That module imports
 * `wgwFetch` from `http.ts`, and logout imports this file, so calling it
 * here would cycle.
 */
async function deleteServerPushSubscription(
  authorizedFetch: AuthorizedFetch,
  endpoint: string,
): Promise<void> {
  const res = await authorizedFetch("/notifications/push/subscriptions", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  });
  if (!res.ok) {
    throw new Error(`DELETE push subscription failed (${res.status})`);
  }
}

type WipeTargets = {
  accountNames: string[];
  collabNames: string[];
  /** Null when `indexedDB.databases()` is missing or rejects. */
  listedNames: string[] | null;
};

async function databasesToWipe(): Promise<string[]> {
  const targets = await collectWipeTargets();
  return [...targets.accountNames, ...targets.collabNames];
}

async function collectWipeTargets(): Promise<WipeTargets> {
  const listed = await listIndexedDatabaseNames();
  const accountNames = await accountNamesFromListing(listed);
  const collabNames = new Set<string>();
  for (const roomKey of await roomKeysFromAccountDatabases(accountNames)) {
    addCollabNames(collabNames, roomKey);
  }
  for (const nodeId of await nodeIdsFromAccountDatabases(accountNames)) {
    collabNames.add(`${nodeId}${DOCS_IDENTITY_DB_SUFFIX}`);
  }
  if (listed) {
    for (const name of listed) {
      if (isDocsIdentityDatabaseName(name)) collabNames.add(name);
      const roomKey = roomKeyFromListedCollabDatabase(name);
      if (roomKey) addCollabNames(collabNames, roomKey);
    }
  }
  return { accountNames, collabNames: [...collabNames], listedNames: listed };
}

/**
 * Account databases this logout will delete.
 * When `indexedDB.databases()` is missing or rejects, only databases whose
 * usernames are still in localStorage are reached. Collab rooms then come from
 * the notes and docs tables in those databases, so a `:v2` room that is not
 * referenced there survives. The logout test that removes `databases()` covers
 * that narrower path.
 */
async function accountNamesFromListing(listed: string[] | null): Promise<string[]> {
  if (listed) return listed.filter((name) => name.startsWith(OFFLINE_DB_PREFIX));
  const { offlineAccountKeyFromUsername } = await import("@/lib/offline/core/offline-db");
  return databaseNamesFromRememberedUsernames(offlineAccountKeyFromUsername);
}

function databaseNamesFromRememberedUsernames(
  accountKeyFromUsername: AccountKeyFromUsername,
): string[] {
  if (typeof window === "undefined") return [];
  const names = new Set<string>();
  for (const key of offlineStorageKeys()) {
    if (!key.endsWith(OFFLINE_USERNAME_SUFFIX)) continue;
    const username = window.localStorage.getItem(key);
    if (username == null) continue;
    names.add(`${OFFLINE_DB_PREFIX}${accountKeyFromUsername(username)}`);
  }
  return [...names];
}

async function roomKeysFromAccountDatabases(accountNames: string[]): Promise<string[]> {
  const keys: string[] = [];
  for (const name of accountNames) {
    try {
      keys.push(...(await readObjectStoreKeys(name, NOTES_STORE)));
      keys.push(...(await readObjectStoreKeys(name, DOCS_STORE)));
    } catch (error) {
      appendLogoutStepFailure("collab-rooms", error);
    }
  }
  return keys;
}

/** Current `:v2` name plus the pre-v2 names from `docsCollabLegacyIndexedDbKeys`. */
function addCollabNames(names: Set<string>, roomKey: string): void {
  const room = roomKey.trim().replace(/^\/+/, "");
  if (!room || room.startsWith(OFFLINE_DB_PREFIX)) return;
  names.add(`${room}${COLLAB_DB_SUFFIX}`);
  names.add(room);
  names.add(`/${room}`);
}

function isDocsIdentityDatabaseName(name: string): boolean {
  return name.endsWith(DOCS_IDENTITY_DB_SUFFIX) && !name.startsWith(OFFLINE_DB_PREFIX);
}

function roomKeyFromListedCollabDatabase(name: string): string | null {
  if (!name.endsWith(COLLAB_DB_SUFFIX) || name.startsWith(OFFLINE_DB_PREFIX)) return null;
  const room = name.slice(0, -COLLAB_DB_SUFFIX.length);
  return room ? room : null;
}

async function nodeIdsFromAccountDatabases(accountNames: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const name of accountNames) {
    try {
      ids.push(...(await readNodeIds(name, DOCS_STORE)));
      ids.push(...(await readNodeIds(name, DRIVE_ENTRIES_STORE)));
    } catch (error) {
      appendLogoutStepFailure("collab-rooms", error);
    }
  }
  return ids;
}

function readNodeIds(databaseName: string, storeName: string): Promise<string[]> {
  const missing: string[] = [];
  return openStore(databaseName, storeName, missing, (store, done, fail) => {
    const request = store.getAll();
    request.onerror = () => fail(request.error ?? new Error(`read ${storeName} failed`));
    request.onsuccess = () => {
      const rows = Array.isArray(request.result) ? request.result : [];
      done(
        rows.flatMap((row) => {
          if (!row || typeof row !== "object" || !("nodeId" in row)) return [];
          const nodeId = row.nodeId;
          return typeof nodeId === "string" && nodeId.trim() ? [nodeId.trim()] : [];
        }),
      );
    };
  });
}

/** One room counts once, even when both the `:v2` database and a legacy name have the flag. */
async function countPendingCollabRooms(databaseNames: string[]): Promise<number> {
  const rooms = new Set<string>();
  for (const name of databaseNames) {
    if (!(await collabDatabaseHasPendingSave(name))) continue;
    rooms.add(collabRoomKeyFromDatabaseName(name));
  }
  return rooms.size;
}

function collabRoomKeyFromDatabaseName(name: string): string {
  const withoutVersion = name.endsWith(COLLAB_DB_SUFFIX)
    ? name.slice(0, -COLLAB_DB_SUFFIX.length)
    : name.endsWith(DOCS_IDENTITY_DB_SUFFIX)
      ? name.slice(0, -DOCS_IDENTITY_DB_SUFFIX.length)
      : name;
  return withoutVersion.replace(/^\/+/, "");
}

/**
 * Logout reads the y-indexeddb `custom` store directly so a stuck Y.Doc sync
 * cannot hang the wipe. Docs prune and Notes use `collabIndexedDbHasPendingServerSave`.
 */
async function collabDatabaseHasPendingSave(databaseName: string): Promise<boolean> {
  const value = await readObjectStoreValue(
    databaseName,
    COLLAB_CUSTOM_STORE,
    PENDING_SERVER_SAVE_KEY,
  );
  return Boolean(value);
}

function readObjectStoreValue(
  databaseName: string,
  storeName: string,
  key: string,
): Promise<unknown> {
  return openStore(databaseName, storeName, undefined, (store, done, fail) => {
    const request = store.get(key);
    request.onerror = () => fail(request.error ?? new Error(`read ${storeName} failed`));
    request.onsuccess = () => done(request.result);
  });
}

async function listIndexedDatabaseNames(): Promise<string[] | null> {
  if (typeof indexedDB === "undefined" || typeof indexedDB.databases !== "function") return null;
  try {
    const rows = await indexedDB.databases();
    return rows.flatMap((row) => (row.name ? [row.name] : []));
  } catch {
    return null;
  }
}

function readObjectStoreKeys(databaseName: string, storeName: string): Promise<string[]> {
  const missing: string[] = [];
  return openStore(databaseName, storeName, missing, (store, done, fail) => {
    const request = store.getAllKeys();
    request.onerror = () => fail(request.error ?? new Error(`read ${storeName} failed`));
    request.onsuccess = () => {
      done(request.result.flatMap((key) => (typeof key === "string" ? [key] : [])));
    };
  });
}

function countObjectStore(databaseName: string, storeName: string): Promise<number> {
  return openStore(databaseName, storeName, 0, (store, done, fail) => {
    const request = store.count();
    request.onerror = () => fail(request.error ?? new Error(`count ${storeName} failed`));
    request.onsuccess = () => done(request.result);
  });
}

function openStore<T>(
  databaseName: string,
  storeName: string,
  missing: T,
  read: (store: IDBObjectStore, done: (value: T) => void, fail: (error: unknown) => void) => void,
): Promise<T> {
  return openExistingDatabase(databaseName).then((db) => {
    if (!db || !db.objectStoreNames.contains(storeName)) {
      db?.close();
      return missing;
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        fail(new Error(`read ${storeName} timed out`));
      }, INDEXED_DB_STEP_TIMEOUT_MS);
      const finish = (value: T) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        db.close();
        resolve(value);
      };
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        db.close();
        reject(error);
      };
      const tx = db.transaction(storeName, "readonly");
      tx.onabort = () => fail(tx.error ?? new Error(`read ${storeName} aborted`));
      tx.onerror = () => fail(tx.error ?? new Error(`read ${storeName} failed`));
      read(tx.objectStore(storeName), finish, fail);
    });
  });
}

/**
 * `indexedDB.open` creates a missing database. Abort that upgrade so a count
 * or room-key read cannot leave an empty database behind when logout is cancelled.
 */
function openExistingDatabase(databaseName: string): Promise<IDBDatabase | null> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      fail(new Error(`open ${databaseName} timed out`));
    }, INDEXED_DB_STEP_TIMEOUT_MS);
    const finish = (value: IDBDatabase | null) => {
      if (settled) {
        value?.close();
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const request = indexedDB.open(databaseName);
    let created = false;
    request.onupgradeneeded = () => {
      created = true;
      request.transaction?.abort();
    };
    request.onblocked = () => {
      fail(new Error(`open ${databaseName} blocked`));
    };
    request.onerror = () => {
      if (created || request.error?.name === "AbortError") {
        finish(null);
        return;
      }
      fail(request.error ?? new Error(`open ${databaseName} failed`));
    };
    request.onsuccess = () => {
      const db = request.result;
      if (!created) {
        finish(db);
        return;
      }
      db.close();
      const drop = indexedDB.deleteDatabase(databaseName);
      drop.onsuccess = () => finish(null);
      drop.onerror = () => finish(null);
    };
  });
}

function removeOfflineLocalStorageKeys(): void {
  if (typeof window === "undefined") return;
  for (const key of offlineStorageKeys()) {
    window.localStorage.removeItem(key);
  }
}

function offlineStorageKeys(): string[] {
  const keys: string[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (key?.startsWith(OFFLINE_STORAGE_PREFIX)) keys.push(key);
  }
  return keys;
}
