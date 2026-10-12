import Dexie from "dexie";
import {
  offlineAccountKeyFromUsername,
  resetOfflineDatabaseCache,
} from "@/lib/offline/core/offline-db";

const OFFLINE_DB_PREFIX = "wgw-offline-";
const OFFLINE_STORAGE_PREFIX = "wgw.offline.";
const OFFLINE_USERNAME_SUFFIX = ".username";

type AuthorizedFetch = (path: string, init?: RequestInit) => Promise<Response>;

/** Run one logout step without letting its failure skip the remaining steps. */
export async function runLogoutStep(step: () => Promise<void>): Promise<void> {
  try {
    await step();
  } catch {
    // Token revoke, push removal, and the local wipe are independent.
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

/** Close and delete every offline account database, then forget remembered usernames. */
export async function wipeOfflineAccountData(): Promise<void> {
  const names = await listWgwOfflineDatabaseNames();
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

async function currentPushSubscription(): Promise<PushSubscription | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return null;
  return registration.pushManager.getSubscription();
}

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

async function listWgwOfflineDatabaseNames(): Promise<string[]> {
  const listed = await listIndexedDatabaseNames();
  if (listed) return listed.filter((name) => name.startsWith(OFFLINE_DB_PREFIX));
  return databaseNamesFromRememberedUsernames();
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

function databaseNamesFromRememberedUsernames(): string[] {
  if (typeof window === "undefined") return [];
  const names = new Set<string>();
  for (const key of offlineStorageKeys()) {
    if (!key.endsWith(OFFLINE_USERNAME_SUFFIX)) continue;
    const username = window.localStorage.getItem(key);
    if (username == null) continue;
    names.add(`${OFFLINE_DB_PREFIX}${offlineAccountKeyFromUsername(username)}`);
  }
  return [...names];
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
