import { appendLogoutStepFailure } from "@/lib/api/wgw/session-debug";

const OFFLINE_DB_PREFIX = "wgw-offline-";
const OFFLINE_STORAGE_PREFIX = "wgw.offline.";
const OFFLINE_USERNAME_SUFFIX = ".username";
/** y-indexeddb room name from `docsCollabIndexedDbKey`. Nothing else on this origin uses it. */
const COLLAB_DB_SUFFIX = ":v2";
const NOTES_STORE = "notes_notes";
const DOCS_STORE = "docs_availability";
const OUTBOX_STORE = "outbox";

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
 * outbox, so unsynced mutations are discarded with it. The logout screen counts
 * those rows and asks before it calls this.
 */
export async function wipeOfflineAccountData(): Promise<void> {
  const Dexie = (await import("dexie")).default;
  const { resetOfflineDatabaseCache } = await import("@/lib/offline/core/offline-db");
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

/** Outbox rows the next logout wipe would discard. */
export async function countLogoutOutboxMutations(): Promise<number> {
  const names = await accountDatabaseNames();
  let total = 0;
  for (const name of names) {
    total += await countObjectStore(name, OUTBOX_STORE);
  }
  return total;
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

async function databasesToWipe(): Promise<string[]> {
  const listed = await listIndexedDatabaseNames();
  const accountNames = await accountNamesFromListing(listed);
  const names = new Set<string>(accountNames);
  for (const roomKey of await roomKeysFromAccountDatabases(accountNames)) {
    addCollabNames(names, roomKey);
  }
  if (listed) {
    for (const name of listed) {
      const roomKey = roomKeyFromListedCollabDatabase(name);
      if (roomKey) addCollabNames(names, roomKey);
    }
  }
  return [...names];
}

/**
 * Account databases this logout will delete.
 * When `indexedDB.databases()` is missing or rejects, only databases whose
 * usernames are still in localStorage are reached. Collab rooms then come from
 * the notes and docs tables in those databases, so a `:v2` room that is not
 * referenced there survives. The logout test that removes `databases()` covers
 * that narrower path.
 */
async function accountDatabaseNames(): Promise<string[]> {
  return accountNamesFromListing(await listIndexedDatabaseNames());
}

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

function roomKeyFromListedCollabDatabase(name: string): string | null {
  if (!name.endsWith(COLLAB_DB_SUFFIX) || name.startsWith(OFFLINE_DB_PREFIX)) return null;
  const room = name.slice(0, -COLLAB_DB_SUFFIX.length);
  return room ? room : null;
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
      const tx = db.transaction(storeName, "readonly");
      const finish = (value: T) => {
        db.close();
        resolve(value);
      };
      const fail = (error: unknown) => {
        db.close();
        reject(error);
      };
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
    const request = indexedDB.open(databaseName);
    let created = false;
    request.onupgradeneeded = () => {
      created = true;
      request.transaction?.abort();
    };
    request.onerror = () => {
      if (created || request.error?.name === "AbortError") {
        resolve(null);
        return;
      }
      reject(request.error ?? new Error(`open ${databaseName} failed`));
    };
    request.onsuccess = () => {
      const db = request.result;
      if (!created) {
        resolve(db);
        return;
      }
      db.close();
      const drop = indexedDB.deleteDatabase(databaseName);
      drop.onsuccess = () => resolve(null);
      drop.onerror = () => resolve(null);
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
