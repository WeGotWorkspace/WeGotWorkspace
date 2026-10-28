/**
 * Web Push scope per installed app (#1606).
 *
 * The subscribe request names the app that made it: the manifest `id` when the
 * page runs as an installed app (`display-mode: standalone`), `/` in a browser
 * tab or the suite PWA. The server only sends that subscription the
 * notifications of that app; `/` receives everything.
 *
 * On iOS each Home Screen app has its own storage and subscription, so this is
 * what keeps a Docs app from showing Calendar alerts. Desktop and Android share
 * one service worker and subscription, so a browser tab posting `/` widens it
 * back to everything there.
 *
 * The worker cannot read display-mode, so pages remember the scopes they posted
 * in IndexedDB; `pushsubscriptionchange` posts the new endpoint with them.
 */

export const ROOT_PUSH_SCOPE = "/";

/** `id` (equal to `scope`) of every manifest in `public/manifests`. */
export const PWA_MANIFEST_IDS = [
  "/",
  "/admin",
  "/calendar",
  "/contacts",
  "/docs",
  "/drive",
  "/meet",
  "/notes",
  "/settings",
  "/tasks",
] as const;

export type PushScope = (typeof PWA_MANIFEST_IDS)[number];

export function isPushScope(value: unknown): value is PushScope {
  return typeof value === "string" && (PWA_MANIFEST_IDS as readonly string[]).includes(value);
}

/** True when `path` (pathname with optional query or hash) opens inside `scope`. */
export function isWithinPushScope(path: string, scope: string): boolean {
  if (scope === ROOT_PUSH_SCOPE || path === scope) return true;
  if (!path.startsWith(scope)) return false;
  const next = path.charAt(scope.length);
  return next === "/" || next === "?" || next === "#";
}

/** Manifest id of the app whose scope holds `pathname`; `/` when none does. */
function manifestIdForPath(pathname: string): PushScope {
  let best: PushScope = ROOT_PUSH_SCOPE;
  for (const id of PWA_MANIFEST_IDS) {
    if (id.length > best.length && isWithinPushScope(pathname, id)) best = id;
  }
  return best;
}

export function pushScopeForLaunch(input: { standalone: boolean; launchPath: string }): PushScope {
  return input.standalone ? manifestIdForPath(input.launchPath) : ROOT_PUSH_SCOPE;
}

type DisplayWindow = {
  matchMedia?: (query: string) => Pick<MediaQueryList, "matches">;
  /** `Navigator`; iOS adds a non-standard `standalone` flag. */
  navigator: object;
};

export function isStandaloneDisplay(win: DisplayWindow): boolean {
  // iOS Safari before display-mode support only sets `navigator.standalone`.
  if ((win.navigator as { standalone?: unknown }).standalone === true) return true;
  return win.matchMedia?.("(display-mode: standalone)").matches === true;
}

let launchPath: string | null = null;

/**
 * Record the path the page loaded at. An installed app always opens inside its
 * own scope (its start URL, or a notification link for it); a later sign-in
 * redirect or in-app link to another app must not change which app this is.
 * The first call wins.
 */
export function rememberLaunchPath(pathname: string): void {
  launchPath ??= pathname;
}

/** Test-only. */
export function resetPushScopeLaunchForTests(): void {
  launchPath = null;
}

export function currentPushScope(
  win: DisplayWindow & { location: { pathname: string } } = window,
): PushScope {
  return pushScopeForLaunch({
    standalone: isStandaloneDisplay(win),
    launchPath: launchPath ?? win.location.pathname,
  });
}

/** Same rule as the server: every app scope is kept, and `/` replaces them all. */
export function mergePushScopes(stored: readonly string[], incoming: string): string[] {
  const scopes = [...new Set([...stored, incoming])];
  if (scopes.includes(ROOT_PUSH_SCOPE)) return [ROOT_PUSH_SCOPE];
  return scopes.sort();
}

const DB_NAME = "wgw-push-scope";
const STORE = "kv";
const KEY = "scopes";

function openScopeDb(idb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = idb.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });
}

function inStore<T>(
  idb: IDBFactory,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openScopeDb(idb).then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = run(tx.objectStore(STORE));
        tx.oncomplete = () => {
          db.close();
          resolve(request.result);
        };
        tx.onerror = tx.onabort = () => {
          db.close();
          reject(tx.error ?? new Error("IndexedDB transaction failed"));
        };
      }),
  );
}

/** Scopes the pages of this browser storage posted; empty when none (unknown). */
export async function readPushScopes(idb: IDBFactory = indexedDB): Promise<PushScope[]> {
  const value = await inStore<unknown>(idb, "readonly", (store) => store.get(KEY));
  return Array.isArray(value) ? value.filter(isPushScope) : [];
}

export async function rememberPushScope(scope: string, idb: IDBFactory = indexedDB): Promise<void> {
  if (!isPushScope(scope)) return;
  const next = mergePushScopes(await readPushScopes(idb), scope);
  await inStore(idb, "readwrite", (store) => store.put(next, KEY));
}
