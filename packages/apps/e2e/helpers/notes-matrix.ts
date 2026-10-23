// Helpers for the Notes sync matrix (`notes-sync-matrix.spec.ts`): users,
// per-tab offline, the server state per user, and "does every tab match it".
import type { Browser, BrowserContext, CDPSession, Page } from "@playwright/test";

const API = process.env.WGW_E2E_API_URL ?? "http://127.0.0.1:9080";
const APP = process.env.WGW_APPS_E2E_BASE_URL ?? "http://127.0.0.1:5173";

export const OWNER = process.env.WGW_E2E_USERNAME ?? "admin";
export const TEAMMATE = process.env.WGW_E2E_TEAMMATE ?? "member";
const PASSWORDS: Record<string, string> = {
  [OWNER]: process.env.WGW_E2E_PASSWORD ?? "storybook-dev",
  [TEAMMATE]:
    process.env.WGW_E2E_TEAMMATE_PASSWORD ?? process.env.WGW_E2E_PASSWORD ?? "storybook-dev",
};

/** The shared notebook both users see: a group with the owner and the teammate. */
export const TEAM_SLUG = "e2e-notes-team";
export const TEAM_NOTEBOOK = `group-${TEAM_SLUG}`;
export const TEAM_NOTEBOOK_NAME = "E2E Notes Team";
export const PRIVATE_NOTEBOOK = "notes-general";
export const PRIVATE_NOTEBOOK_NAME = "General";

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// --- API ----------------------------------------------------------------------------------------

type Login = { accessToken: string; refreshCookie: string | null; at: number };
const logins = new Map<string, Login>();

async function login(user: string): Promise<Login> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const res = await fetch(`${API}/api/v1/auth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: user, password: PASSWORDS[user] }),
    });
    if (res.status === 429) {
      await sleep(10_000);
      continue;
    }
    if (!res.ok) throw new Error(`Login ${user} failed: ${res.status} ${await res.text()}`);
    const tokens = (await res.json()) as { access_token: string };
    const cookie = (res.headers.getSetCookie?.() ?? []).find((c) => c.startsWith("wgw_refresh="));
    return {
      accessToken: tokens.access_token,
      refreshCookie: cookie ? cookie.split(";")[0]!.slice("wgw_refresh=".length) : null,
      at: Date.now(),
    };
  }
  throw new Error(`Login ${user} kept hitting the rate limit`);
}

/** A cached token for API calls from the test (not for a browser, which needs its own login). */
async function token(user: string): Promise<string> {
  const hit = logins.get(user);
  if (hit && Date.now() - hit.at < 300_000) return hit.accessToken;
  const fresh = await login(user);
  logins.set(user, fresh);
  return fresh.accessToken;
}

export async function api(
  user: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: unknown }> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const res = await fetch(`${API}/api/v1${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${await token(user)}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 429) {
      await sleep(10_000);
      continue;
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, json };
  }
  throw new Error(`${method} ${path} kept hitting the rate limit`);
}

/** The shared notebook: a group with both users (idempotent). */
export async function ensureTeamNotebook(): Promise<void> {
  await api(OWNER, "POST", "/admin/groups", { slug: TEAM_SLUG, displayName: TEAM_NOTEBOOK_NAME });
  await api(OWNER, "PUT", `/admin/groups/${TEAM_SLUG}/members/${OWNER}`);
  await api(OWNER, "PUT", `/admin/groups/${TEAM_SLUG}/members/${TEAMMATE}`);
  const res = await api(TEAMMATE, "GET", "/notes/notebooks");
  const list = ((res.json as { list?: Array<{ id: string }> })?.list ?? []).map((n) => n.id);
  if (!list.includes(TEAM_NOTEBOOK)) {
    throw new Error(`${TEAMMATE} does not see ${TEAM_NOTEBOOK} (has: ${list.join(", ")})`);
  }
}

export type ServerNote = {
  id: string;
  title: string;
  body: string;
  tags: string[];
  notebook: string;
  archived: boolean;
};

/** Notebook key both sides agree on: "general", "e2e-notes-team", ... */
export function notebookKey(id: string | undefined): string {
  return String(id ?? "").replace(/^(notes|group)-/, "");
}

/** The note as `user` may see it on the server, or null when they cannot (or it is gone). */
export async function serverNote(user: string, uid: string): Promise<ServerNote | null> {
  const res = await api(user, "GET", `/notes/items/${uid}`);
  if (res.status === 404 || res.status === 403) return null;
  if (res.status !== 200) throw new Error(`GET note ${uid} as ${user}: ${res.status}`);
  const note = res.json as {
    id: string;
    title?: string | null;
    body?: string | null;
    categories?: string[];
    notebookId?: string;
    status?: string | null;
  };
  return {
    id: note.id,
    title: note.title ?? "",
    body: (note.body ?? "").replace(/\s+/g, " ").trim(),
    tags: [...(note.categories ?? [])].sort(),
    notebook: notebookKey(note.notebookId),
    archived: note.status === "CANCELLED",
  };
}

// --- browser ------------------------------------------------------------------------------------

export type Tab = Page & { tag: string; user: string; cdp?: CDPSession };

/** One isolated browser context (own IndexedDB) signed in as `user`. */
export async function openUser(browser: Browser, user: string): Promise<BrowserContext> {
  const { accessToken, refreshCookie } = await login(user);
  const context = await browser.newContext({
    baseURL: APP,
    storageState: { cookies: [], origins: [] },
    viewport: { width: 1400, height: 900 },
  });
  if (refreshCookie) {
    const app = new URL(APP);
    await context.addCookies([
      {
        name: "wgw_refresh",
        value: refreshCookie,
        domain: app.hostname,
        path: "/api/v1/auth",
        httpOnly: true,
        sameSite: "Strict",
      },
    ]);
  }
  await context.addInitScript(
    ({ access }) => {
      localStorage.setItem("wgw.api.access_token", access);
      localStorage.setItem("wgw.api.session_kind", "member");
    },
    { access: accessToken },
  );
  return context;
}

/** A Notes tab that records error toasts and page errors into `events`. */
export async function openNotesTab(
  context: BrowserContext,
  user: string,
  tag: string,
  events: string[],
): Promise<Tab> {
  const page = (await context.newPage()) as Tab;
  page.tag = tag;
  page.user = user;
  page.on("pageerror", (error) => events.push(`${tag} page error: ${String(error).slice(0, 160)}`));
  await page.goto("/notes");
  await page.getByRole("button", { name: "New note" }).waitFor({ timeout: 60_000 });
  await page
    .getByLabel("Loading notes…")
    .waitFor({ state: "detached", timeout: 60_000 })
    .catch(() => undefined);
  return page;
}

/** DevTools "Offline" for this tab only. */
export async function setTabOffline(tab: Tab, offline: boolean): Promise<void> {
  if (!tab.cdp) {
    tab.cdp = await tab.context().newCDPSession(tab);
    await tab.cdp.send("Network.enable");
  }
  await tab.cdp.send("Network.emulateNetworkConditions", {
    offline,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  await tab
    .evaluate((off) => window.dispatchEvent(new Event(off ? "offline" : "online")), offline)
    .catch(() => undefined);
}

type TabNote = {
  missingDb?: boolean;
  outbox: number;
  row: null | {
    pending: boolean;
    title: string;
    body: string;
    tags: string[];
    notebook: string;
    archived: boolean;
  };
};

/** The tab's offline cache for one note, and how many outbox rows still name it. */
async function tabNote(tab: Tab, uid: string): Promise<TabNote> {
  return tab.evaluate(async (id) => {
    const open = (name: string) =>
      new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    const read = <T>(db: IDBDatabase, store: string, run: (s: IDBObjectStore) => IDBRequest<T>) =>
      new Promise<T | undefined>((resolve) => {
        const request = run(db.transaction(store).objectStore(store));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(undefined);
      });
    const user = localStorage.getItem("wgw.offline.notes.username");
    if (!user) return { missingDb: true, outbox: 0, row: null };
    const db = await open(`wgw-offline-${user}`);
    if (![...db.objectStoreNames].includes("notes_notes")) {
      db.close();
      return { missingDb: true, outbox: 0, row: null };
    }
    const row = (await read(db, "notes_notes", (s) => s.get(id))) as
      { pendingSync: boolean; data: string } | undefined;
    const outboxRows = ((await read(db, "outbox", (s) => s.getAll())) ?? []) as Array<{
      domain: string;
      payload: string;
    }>;
    db.close();
    const outbox = outboxRows.filter((r) => r.domain === "notes" && r.payload.includes(id)).length;
    if (!row) return { outbox, row: null };
    const note = JSON.parse(row.data) as {
      title?: string;
      excerpt?: string;
      tags?: string[];
      notebookId?: string;
      notebook?: string;
      archived?: boolean;
    };
    return {
      outbox,
      row: {
        pending: row.pendingSync,
        title: note.title ?? "",
        body: (note.excerpt ?? "").replace(/\s+/g, " ").trim(),
        tags: [...(note.tags ?? [])].sort(),
        notebook: note.notebookId ?? note.notebook ?? "",
        archived: Boolean(note.archived),
      },
    };
  }, uid);
}

/** What a tab shows that differs from the server, for one note. Empty means in sync. */
async function tabDiff(tab: Tab, want: ServerNote | null, uid: string): Promise<string[]> {
  const have = await tabNote(tab, uid);
  if (have.missingDb) return ["no offline cache"];
  if (!want) {
    return have.row && !have.row.archived
      ? ["still shows a note the server no longer gives it"]
      : [];
  }
  if (!have.row) return ["is missing the note"];
  const diffs: string[] = [];
  const row = have.row;
  if (row.pending) diffs.push("still pending");
  if (have.outbox) diffs.push(`${have.outbox} outbox row(s)`);
  if (row.title !== want.title) diffs.push(`title "${row.title}" ≠ "${want.title}"`);
  if (row.tags.join(",") !== want.tags.join(",")) diffs.push(`tags [${row.tags}] ≠ [${want.tags}]`);
  if (notebookKey(row.notebook) !== want.notebook)
    diffs.push(`notebook ${row.notebook} ≠ ${want.notebook}`);
  if (row.archived !== want.archived) diffs.push(`archived ${row.archived} ≠ ${want.archived}`);
  // The cache keeps a short excerpt of the body: it must be the body's start,
  // and empty exactly when the body is.
  const cached = row.body.slice(0, 30);
  if (!want.body.startsWith(cached) || (want.body === "") !== (row.body === "")) {
    diffs.push(`body "${cached}" ≠ "${want.body.slice(0, 30)}"`);
  }
  return diffs;
}

/** Poll until every tab mirrors the server for `uid`; returns what still differs. */
export async function converge(
  tabs: Tab[],
  uid: string,
  timeoutMs: number,
): Promise<Record<string, string[]>> {
  const until = Date.now() + timeoutMs;
  let open: Record<string, string[]> = {};
  do {
    open = {};
    const wanted = new Map<string, ServerNote | null>();
    for (const tab of tabs) {
      if (!wanted.has(tab.user)) wanted.set(tab.user, await serverNote(tab.user, uid));
      const diffs = await tabDiff(tab, wanted.get(tab.user) ?? null, uid).catch(
        (error: unknown) => [`check failed: ${String(error).slice(0, 80)}`],
      );
      if (diffs.length) open[tab.tag] = diffs;
    }
    if (Object.keys(open).length === 0) return {};
    await sleep(1_500);
  } while (Date.now() < until);
  return open;
}

/** Titles in the tab's visible list. */
export async function listTitles(tab: Tab): Promise<string[]> {
  return tab
    .locator(".list-item__button")
    .evaluateAll((els) => els.map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim()));
}
