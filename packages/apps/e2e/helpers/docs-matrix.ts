// Helpers for the Docs sync matrix (`docs-sync-matrix.spec.ts`): what the
// server holds for one Doc as each user sees it, what a tab holds in its
// offline cache, and "does every tab match the server". Users, API calls and
// per-tab offline live in `live-matrix.ts`.
import { api, passwordFor, type Tab } from "./live-matrix";

export { api, openUser, OWNER, setTabOffline, TEAMMATE, type Tab } from "./live-matrix";

const API = process.env.WGW_E2E_API_URL ?? "http://127.0.0.1:9080";

/** Personal home of a user, as an API path. */
export const home = (user: string) => `/users/${user}`;
/** The Team folder `wgw:dev-install` gives the owner and the teammate (#1925). */
export const TEAM_ROOT = "/groups/team";

export const trashOf = (root: string) => `${root}/.Trash`;

// --- WebDAV, as a desktop client would ---------------------------------------------------------

function davUrl(apiPath: string): string {
  return `${API}/files/${apiPath
    .replace(/^\/+/, "")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
}

/** WebDAV as `user`. Retries a 429 so a case never flakes on the request budget. */
export async function dav(
  user: string,
  method: string,
  apiPath: string,
  init: { headers?: Record<string, string>; body?: string } = {},
): Promise<Response> {
  const auth = `Basic ${Buffer.from(`${user}:${passwordFor(user)}`).toString("base64")}`;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const res = await fetch(davUrl(apiPath), {
      method,
      headers: { Authorization: auth, ...init.headers },
      body: init.body,
    });
    if (res.status !== 429) return res;
    await new Promise((resolve) => setTimeout(resolve, 1_000 * (attempt + 1)));
  }
  throw new Error(`${method} ${apiPath} as ${user} stayed rate limited`);
}

export async function putDoc(user: string, apiPath: string, markdown: string): Promise<void> {
  const res = await dav(user, "PUT", apiPath, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
    body: markdown,
  });
  if (!res.ok) throw new Error(`PUT ${apiPath}: ${res.status} ${await res.text()}`);
}

export async function makeFolder(user: string, apiPath: string): Promise<void> {
  const res = await dav(user, "MKCOL", `${apiPath}/`);
  if (!res.ok && res.status !== 405) throw new Error(`MKCOL ${apiPath}: ${res.status}`);
}

/** The file's text as `user` reads it, or null when it is not there for them. */
export async function readDoc(user: string, apiPath: string): Promise<string | null> {
  const res = await dav(user, "GET", apiPath);
  if (res.status === 404 || res.status === 403) return null;
  if (!res.ok) throw new Error(`GET ${apiPath} as ${user}: ${res.status}`);
  return res.text();
}

/** Names directly inside a folder, as `user` lists it (empty when it is not there). */
export async function listFolder(user: string, apiPath: string): Promise<string[]> {
  const res = await dav(user, "PROPFIND", `${apiPath}/`, { headers: { Depth: "1" } });
  if (res.status === 404 || res.status === 403) return [];
  if (!res.ok) throw new Error(`PROPFIND ${apiPath} as ${user}: ${res.status}`);
  const xml = await res.text();
  const self = `/files/${apiPath.replace(/^\/+/, "")}`.replace(/\/+$/, "");
  return [...xml.matchAll(/<d:href>([^<]+)<\/d:href>/gi)]
    .map((match) => decodeURIComponent(match[1]!).replace(/\/+$/, ""))
    .filter((href) => href !== self && !href.endsWith(self))
    .map((href) => href.split("/").pop() ?? "")
    .filter(Boolean);
}

/** Clean-up: delete what a case made, whatever state it left it in. */
export async function removeQuietly(user: string, apiPaths: readonly string[]): Promise<void> {
  for (const apiPath of apiPaths) await dav(user, "DELETE", apiPath).catch(() => undefined);
}

// --- stars -------------------------------------------------------------------------------------

/** Paths `user` has starred (a star is per person). */
export async function serverStars(user: string): Promise<string[]> {
  const res = await api(user, "GET", "/files/starred");
  if (res.status !== 200) throw new Error(`GET starred as ${user}: ${res.status}`);
  return ((res.json as { data?: { paths?: string[] } }).data?.paths ?? []).map(normalizePath);
}

export function normalizePath(apiPath: string): string {
  return `/${apiPath.replace(/^\/+/, "").replace(/\/+$/, "")}`;
}

// --- what a tab holds offline ------------------------------------------------------------------

export type TabCache = {
  /** No Docs offline database yet (the tab never loaded Docs). */
  missingDb: boolean;
  /** Queued Docs writes (rename, trash, create, star), as their JSON payloads. */
  outbox: string[];
  /** Each cached home view (by cache key): the paths it lists, without a leading slash. */
  views: Record<string, string[]>;
  /** Cached starred paths, normalized with a leading slash. */
  stars: string[];
};

/** The tab's Docs offline cache. */
export async function tabCache(tab: Tab): Promise<TabCache> {
  return tab.evaluate(async () => {
    const user = localStorage.getItem("wgw.offline.docs.username");
    const empty = { missingDb: true, outbox: [], views: {}, stars: [] };
    if (!user) return empty;
    const db = await new Promise<IDBDatabase | null>((resolve) => {
      const request = indexedDB.open(`wgw-offline-${user.trim().toLowerCase()}`);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
    if (!db) return empty;
    const all = <T>(store: string) =>
      new Promise<T[]>((resolve) => {
        if (!db.objectStoreNames.contains(store)) return resolve([]);
        const request = db.transaction(store).objectStore(store).getAll();
        request.onsuccess = () => resolve(request.result as T[]);
        request.onerror = () => resolve([]);
      });
    const hasListing = db.objectStoreNames.contains("docs_listing_rows");
    const outbox = (await all<{ domain: string; payload: string }>("outbox"))
      .filter((row) => row.domain === "docs")
      .map((row) => row.payload);
    const views: Record<string, string[]> = {};
    for (const row of await all<{ cacheKey: string; sourceKey: string }>("docs_listing_rows")) {
      (views[row.cacheKey] ??= []).push(row.sourceKey.replace(/^\/+/, ""));
    }
    const meta = await all<{ key: string; value: string }>("meta");
    db.close();
    let stars: string[] = [];
    try {
      const raw = meta.find((row) => row.key === "docs.starredPaths")?.value;
      stars = raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      stars = [];
    }
    return {
      missingDb: !hasListing,
      outbox,
      views,
      stars: stars.map((path) => `/${path.replace(/^\/+/, "").replace(/\/+$/, "")}`),
    };
  });
}

/**
 * The tab's Drive cache knows this path with its FileNode id (the first
 * FileNode inbound ran), so an offline rename, move or trash can find it.
 */
export async function driveKnows(tab: Tab, apiPath: string): Promise<boolean> {
  return tab.evaluate(
    async (id) => {
      const user = localStorage.getItem("wgw.offline.docs.username");
      if (!user) return false;
      return new Promise<boolean>((resolve) => {
        const request = indexedDB.open(`wgw-offline-${user.trim().toLowerCase()}`);
        request.onerror = () => resolve(false);
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("drive_entries")) return resolve(false);
          const get = db.transaction("drive_entries").objectStore("drive_entries").get(id);
          get.onsuccess = () => resolve(Boolean((get.result as { nodeId?: string })?.nodeId));
          get.onerror = () => resolve(false);
        };
      });
    },
    apiPath.replace(/^\/+/, ""),
  );
}

/** Shared with `user`, by the owner's path (the "Shared with me" view). */
export async function sharedWith(user: string): Promise<string[]> {
  const res = await api(user, "GET", "/files/shared-with-me");
  if (res.status !== 200) throw new Error(`GET shared-with-me as ${user}: ${res.status}`);
  const rows = (res.json as { data?: Array<{ entry?: { path?: string } }> }).data ?? [];
  return rows.map((row) => normalizePath(row.entry?.path ?? "")).filter((path) => path !== "/");
}

/** Who else `path` is shared with, as its owner sees it. */
export async function sharesOf(owner: string, apiPath: string): Promise<string[]> {
  const res = await api(owner, "GET", `/files/shares?path=${encodeURIComponent(apiPath)}`);
  if (res.status !== 200) return [];
  const body = res.json as { data?: Array<{ shareWith?: Record<string, unknown> }> };
  return (body.data ?? []).flatMap((share) => Object.keys(share.shareWith ?? {}));
}

export async function starOnServer(user: string, apiPath: string): Promise<void> {
  const res = await api(user, "POST", `/files/star?path=${encodeURIComponent(apiPath)}`, {});
  if (res.status >= 300) throw new Error(`star ${apiPath} as ${user}: ${res.status}`);
}

/** A share between the two users stays out of every other case: drop it. */
export async function unshareQuietly(owner: string, apiPath: string): Promise<void> {
  const res = await api(owner, "GET", `/files/shares?path=${encodeURIComponent(apiPath)}`);
  const body = res.json as { data?: Array<{ id?: string }> } | null;
  for (const share of body?.data ?? []) {
    if (share.id) await api(owner, "DELETE", `/files/shares/${share.id}`).catch(() => undefined);
  }
}
