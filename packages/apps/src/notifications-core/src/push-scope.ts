/**
 * Web Push scope per installed app (#1606).
 *
 * The subscribe request names the app that made it. Only an iOS Home Screen
 * app has a push subscription of its own, so only there does the request carry
 * the app's manifest id; everywhere else (browser tabs, desktop and Android
 * installed apps, which share one subscription per browser profile) it is `/`.
 * The server sends a subscription only the notifications that open inside its
 * scopes; `/` receives everything.
 *
 * The app is read from the path the window was launched at, kept in
 * sessionStorage so later documents in that window (inbox clicks, reloads,
 * logout) keep it. A window whose first document was `/logout` or `/login`
 * names no app, so the scope is then unknown (`null`) and the request leaves
 * it out, unless `/login?return=` points into an app.
 *
 * The worker cannot tell which app it serves, so pages remember the scopes they
 * posted in IndexedDB; `pushsubscriptionchange` posts the new endpoint with
 * them. Logout forgets them.
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

const PATH_BASE = "https://push-scope.invalid";

/**
 * `path` as the browser opens it: dot segments resolved (also `%2e%2e`), `\`
 * read as `/`. A path that would leave the origin becomes `/`.
 */
export function normalizePushPath(path: string): string {
  let url: URL;
  try {
    url = new URL(path, PATH_BASE);
  } catch {
    return ROOT_PUSH_SCOPE;
  }
  if (url.origin !== PATH_BASE || url.pathname.startsWith("//")) return ROOT_PUSH_SCOPE;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** True when `path` (pathname with optional query or hash) opens inside `scope`. */
export function isWithinPushScope(path: string, scope: string): boolean {
  if (scope === ROOT_PUSH_SCOPE) return true;
  const normalized = normalizePushPath(path);
  if (normalized === scope) return true;
  if (!normalized.startsWith(scope)) return false;
  const next = normalized.charAt(scope.length);
  return next === "/" || next === "?" || next === "#";
}

/** Manifest id of the app (not the suite) whose scope holds `path`. */
function appScopeForPath(path: string): PushScope | null {
  let best: PushScope | null = null;
  for (const id of PWA_MANIFEST_IDS) {
    if (id === ROOT_PUSH_SCOPE || (best && id.length <= best.length)) continue;
    if (isWithinPushScope(path, id)) best = id;
  }
  return best;
}

/** Nested `/login?return=/login?return=…` chains are unwrapped this deep. */
const MAX_RETURN_DEPTH = 3;

function scopeForLaunchPath(launchPath: string, depth: number): PushScope | null {
  const normalized = normalizePushPath(launchPath);
  const url = new URL(normalized, PATH_BASE);
  if (url.pathname === ROOT_PUSH_SCOPE) return ROOT_PUSH_SCOPE;
  const app = appScopeForPath(url.pathname);
  if (app) return app;
  if (url.pathname !== "/login" || depth >= MAX_RETURN_DEPTH) return null;
  const back = url.searchParams.get("return");
  if (!back?.startsWith("/") || back.startsWith("//")) return null;
  // A return to the suite home says nothing about which app this is.
  const scope = scopeForLaunchPath(back, depth + 1);
  return scope === ROOT_PUSH_SCOPE ? null : scope;
}

/**
 * The scope to post, or null when it is not known. `ownSubscription` is true
 * only where each installed app has its own subscription (iOS Home Screen).
 */
export function pushScopeForLaunch(input: {
  ownSubscription: boolean;
  launchPath: string;
}): PushScope | null {
  if (!input.ownSubscription) return ROOT_PUSH_SCOPE;
  return scopeForLaunchPath(input.launchPath, 0);
}

type DisplayWindow = {
  /** `Navigator`; iOS adds a non-standard `standalone` flag. */
  navigator: object;
};

/**
 * True in an iOS Home Screen app, the only place where each installed app gets
 * its own storage and push subscription. Desktop and Android installed apps
 * share the browser profile's subscription, so they must keep posting `/`.
 */
export function hasOwnPushSubscription(win: DisplayWindow): boolean {
  return (win.navigator as { standalone?: unknown }).standalone === true;
}

let launchPath: string | null = null;

/** sessionStorage key: one value per window (Home Screen app), across its documents. */
const LAUNCH_PATH_KEY = "wgw-push-launch-path";

type LaunchPathStorage = Pick<Storage, "getItem" | "setItem">;

function windowSessionStorage(): LaunchPathStorage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

function isSameOriginPath(value: string | null): value is string {
  return value !== null && value.startsWith("/") && !value.startsWith("//");
}

/**
 * Record the path and query the window was launched at. An installed app
 * opens inside its own scope (its start URL, or a notification link for it).
 * Later documents in the same window (an inbox click, a sign-in redirect, a
 * service worker reload, logout) reuse it from sessionStorage, so they do not
 * change which app this is. The first call per document wins. Without
 * sessionStorage, each document uses its own path.
 */
export function rememberLaunchPath(
  pathAndSearch: string,
  storage: LaunchPathStorage | null = windowSessionStorage(),
): void {
  if (launchPath !== null) return;
  let stored: string | null = null;
  try {
    stored = storage?.getItem(LAUNCH_PATH_KEY) ?? null;
  } catch {
    stored = null;
  }
  if (isSameOriginPath(stored)) {
    launchPath = stored;
    return;
  }
  launchPath = pathAndSearch;
  try {
    storage?.setItem(LAUNCH_PATH_KEY, pathAndSearch);
  } catch {
    // Private mode or blocked storage: this document still knows its path.
  }
}

/** Test-only: forget this document's launch path, as a new document would. */
export function resetPushScopeLaunchForTests(): void {
  launchPath = null;
}

export function currentPushScope(
  win: DisplayWindow & { location: { pathname: string; search: string } } = window,
): PushScope | null {
  return pushScopeForLaunch({
    ownSubscription: hasOwnPushSubscription(win),
    launchPath: launchPath ?? `${win.location.pathname}${win.location.search}`,
  });
}

/** Same rule as the server: every app scope is kept, and `/` replaces them all. */
function collapsePushScopes(scopes: readonly PushScope[]): PushScope[] {
  const unique = [...new Set(scopes)];
  if (unique.includes(ROOT_PUSH_SCOPE)) return [ROOT_PUSH_SCOPE];
  return unique.sort();
}

export function mergePushScopes(stored: readonly string[], incoming: string): PushScope[] {
  return collapsePushScopes([...stored, incoming].filter(isPushScope));
}

/**
 * Scopes to post for a new endpoint: the remembered ones and the current one,
 * so a replaced subscription keeps every app scope the old one had. `[null]`
 * (one POST without scope) when none is known.
 */
export function pushScopesToPost(
  remembered: readonly string[],
  current: PushScope | null,
): (PushScope | null)[] {
  const scopes = collapsePushScopes(
    [...remembered, ...(current === null ? [] : [current])].filter(isPushScope),
  );
  return scopes.length > 0 ? scopes : [null];
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

/** Logout: the next account on this device starts without known scopes. */
export async function forgetPushScopes(idb: IDBFactory = indexedDB): Promise<void> {
  await inStore(idb, "readwrite", (store) => store.delete(KEY));
}

export async function rememberPushScope(scope: string, idb: IDBFactory = indexedDB): Promise<void> {
  if (!isPushScope(scope)) return;
  const next = mergePushScopes(await readPushScopes(idb), scope);
  await inStore(idb, "readwrite", (store) => store.put(next, KEY));
}
