// @vitest-environment jsdom
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import { resetWgwSessionStateForTests, wgwEnsureSession, wgwLogout } from "@/lib/api/wgw/http";
import {
  rememberOfflineUsername,
  resolveOfflineUsername,
} from "@/lib/offline/core/offline-account";
import { offlineDbForAccount, resetOfflineDatabaseCache } from "@/lib/offline/core/offline-db";
import {
  countDiscardedUnsyncedChanges,
  releasePushOnLogout,
  runLogoutStep,
} from "@/lib/offline/core/offline-wipe";
import { docsAvailabilityTable } from "@/lib/offline/docs/docs-schema";
import { notesNotesTable } from "@/lib/offline/notes/notes-schema";
import { readPushScopes, rememberPushScope } from "@/notifications-core/src/push-scope";
import { PENDING_SERVER_SAVE_KEY } from "@/text-editor-core/docs-collab/pending-server-save-key";

const ACCESS_TOKEN_KEY = "wgw.api.access_token";
const SESSION_KIND_KEY = "wgw.api.session_kind";
const ACCESS_EXPIRES_AT_KEY = "wgw.api.access_expires_at";
const REFRESH_EXPIRES_AT_KEY = "wgw.api.refresh_expires_at";
const LOGGED_OUT_KEY = "wgw.api.logged_out";

const originalFetch = globalThis.fetch;
const onlineState = { value: true };

function base64url(value: string): string {
  const encoded = btoa(unescape(encodeURIComponent(value)));
  return encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function makeJwt(exp: number): string {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ exp }));
  return `${header}.${payload}.signature`;
}

function installSession(accessExpiresAt: number, refreshExpiresAt: number): void {
  const nowSec = Math.floor(Date.now() / 1_000);
  const accessStillValid = accessExpiresAt > Date.now();
  window.localStorage.setItem(
    ACCESS_TOKEN_KEY,
    makeJwt(nowSec + (accessStillValid ? 3_600 : -100)),
  );
  window.localStorage.setItem(SESSION_KIND_KEY, "member");
  window.localStorage.setItem(ACCESS_EXPIRES_AT_KEY, String(accessExpiresAt));
  window.localStorage.setItem(REFRESH_EXPIRES_AT_KEY, String(refreshExpiresAt));
}

async function seedOfflineAccount(username: string, domain = "calendars"): Promise<void> {
  rememberOfflineUsername(domain, username);
  const db = offlineDbForAccount(username.trim().toLowerCase());
  await db.open();
  await db.meta.put({ key: "secret", value: `${username}-private` });
}

async function indexedDbNames(): Promise<string[]> {
  const rows = await indexedDB.databases();
  return rows.flatMap((row) => (row.name ? [row.name] : []));
}

async function createNamedDatabase(name: string): Promise<void> {
  const db = new Dexie(name);
  db.version(1).stores({ meta: "key" });
  await db.open();
  await db.table("meta").put({ key: "body", value: "secret" });
  db.close();
}

/** Writes the flag the way the editor does, so the store layout comes from y-indexeddb. */
async function seedPendingServerSave(name: string): Promise<void> {
  const ydoc = new Y.Doc();
  const persistence = new IndexeddbPersistence(name, ydoc);
  await persistence.whenSynced;
  await persistence.set(PENDING_SERVER_SAVE_KEY, 1);
  await persistence.destroy();
  ydoc.destroy();
}

function installPushSubscription(endpoint: string): {
  unsubscribe: ReturnType<typeof vi.fn>;
} {
  const unsubscribe = vi.fn(async () => true);
  const getRegistration = vi.fn(async () => ({
    pushManager: {
      getSubscription: vi.fn(async () => ({ endpoint, unsubscribe })),
    },
  }));
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { getRegistration },
  });
  return { unsubscribe };
}

type FetchCall = { url: string; method: string; override: string | null; body: string };

function fetchCalls(fetchMock: ReturnType<typeof vi.fn>): FetchCall[] {
  return fetchMock.mock.calls.map((call) => {
    const init = (call[1] ?? {}) as RequestInit;
    const headers = new Headers(init.headers);
    const body = typeof init.body === "string" ? init.body : "";
    return {
      url: String(call[0]),
      method: (init.method ?? "GET").toUpperCase(),
      override: headers.get("X-HTTP-Method-Override"),
      body,
    };
  });
}

function isPushDelete(call: FetchCall, endpoint: string): boolean {
  if (!call.url.includes("/notifications/push/subscriptions")) return false;
  if (!call.body.includes(endpoint)) return false;
  return call.method === "DELETE" || call.override?.toUpperCase() === "DELETE";
}

beforeEach(() => {
  vi.stubEnv("VITE_WGW_USE_LIVE_API", "1");
  vi.stubEnv("VITE_WGW_DEV_USERNAME", "");
  vi.stubEnv("VITE_WGW_DEV_PASSWORD", "");
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    get: () => onlineState.value,
  });
  onlineState.value = true;
  window.localStorage.clear();
  resetWgwSessionStateForTests();
  globalThis.fetch = vi.fn(async () => new Response("{}", { status: 200 })) as typeof fetch;
});

afterEach(async () => {
  vi.unstubAllEnvs();
  globalThis.fetch = originalFetch;
  resetWgwSessionStateForTests();
  window.localStorage.clear();
  Reflect.deleteProperty(navigator, "serviceWorker");
  resetOfflineDatabaseCache();
  const names = await indexedDbNames();
  await Promise.all(names.map((name) => Dexie.delete(name)));
});

describe("user-initiated logout", () => {
  it("deletes offline databases and remembered usernames", async () => {
    installSession(Date.now() + 3_600_000, Date.now() + 86_400_000);
    window.localStorage.setItem("wgw.offline.deviceContentSettings", '{"contentSyncEnabled":true}');
    window.localStorage.setItem("wgw.ui.theme", "dark");
    await seedOfflineAccount("Alice", "calendars");
    rememberOfflineUsername("notes", "Alice");
    const unrelated = new Dexie("not-wgw-cache");
    unrelated.version(1).stores({ meta: "key" });
    await unrelated.open();
    await unrelated.table("meta").put({ key: "keep", value: "shell" });
    unrelated.close();

    const first = offlineDbForAccount("alice");
    await wgwLogout();

    expect(window.localStorage.getItem("wgw.offline.calendars.username")).toBeNull();
    expect(window.localStorage.getItem("wgw.offline.notes.username")).toBeNull();
    expect(window.localStorage.getItem("wgw.offline.deviceContentSettings")).toBeNull();
    expect(window.localStorage.getItem("wgw.ui.theme")).toBe("dark");
    expect(window.localStorage.getItem(LOGGED_OUT_KEY)).toBe("1");
    expect(window.localStorage.getItem(ACCESS_TOKEN_KEY)).toBeNull();
    const names = await indexedDbNames();
    expect(names).not.toContain("wgw-offline-alice");
    expect(names).toContain("not-wgw-cache");
    expect(offlineDbForAccount("alice")).not.toBe(first);
  });

  it("does not serve a restored username key after logout", async () => {
    installSession(Date.now() + 3_600_000, Date.now() + 86_400_000);
    rememberOfflineUsername("drive", "alice");
    await wgwLogout();
    rememberOfflineUsername("drive", "alice");

    expect(resolveOfflineUsername("drive", undefined)).toBeNull();
    expect(resolveOfflineUsername("drive", "alice")).toBe("alice");
  });

  it("unsubscribes push before revoking tokens, and still wipes when delete fails", async () => {
    const endpoint = "https://push.example.test/subscription/alice";
    const { unsubscribe } = installPushSubscription(endpoint);
    installSession(Date.now() + 3_600_000, Date.now() + 86_400_000);
    await seedOfflineAccount("alice", "chat");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/notifications/push/subscriptions")) {
        return new Response("{}", { status: 500 });
      }
      return new Response("{}", { status: 200 });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    await wgwLogout();

    expect(unsubscribe).toHaveBeenCalledOnce();
    const calls = fetchCalls(fetchMock);
    const pushAt = calls.findIndex((call) => isPushDelete(call, endpoint));
    const revokeAt = calls.findIndex((call) => call.url.endsWith("/auth/revoke"));
    expect(pushAt).toBeGreaterThanOrEqual(0);
    expect(revokeAt).toBeGreaterThan(pushAt);
    expect(window.localStorage.getItem("wgw.offline.chat.username")).toBeNull();
    expect(await indexedDbNames()).not.toContain("wgw-offline-alice");
  });

  it("forgets the remembered push scopes, so the next account does not inherit them", async () => {
    installPushSubscription("https://push.example.test/subscription/alice");
    installSession(Date.now() + 3_600_000, Date.now() + 86_400_000);
    await rememberPushScope("/docs");

    await wgwLogout();

    await expect(readPushScopes()).resolves.toEqual([]);
  });

  it("still wipes when the service worker cannot be read", async () => {
    installSession(Date.now() + 3_600_000, Date.now() + 86_400_000);
    await seedOfflineAccount("alice", "tasks");
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        getRegistration: vi.fn(async () => {
          throw new Error("service worker unavailable");
        }),
      },
    });

    await expect(wgwLogout()).resolves.toBeUndefined();
    expect(window.localStorage.getItem("wgw.offline.tasks.username")).toBeNull();
    expect(await indexedDbNames()).not.toContain("wgw-offline-alice");
  });

  it("deletes every wgw-offline database indexedDB lists, even without a username key", async () => {
    installSession(Date.now() + 3_600_000, Date.now() + 86_400_000);
    await seedOfflineAccount("alice", "docs");
    window.localStorage.removeItem("wgw.offline.docs.username");
    const hidden = offlineDbForAccount("hidden-account");
    await hidden.open();
    await hidden.meta.put({ key: "secret", value: "left-behind" });

    await wgwLogout();

    const names = await indexedDbNames();
    expect(names).not.toContain("wgw-offline-alice");
    expect(names).not.toContain("wgw-offline-hidden-account");
  });

  it("falls back to remembered usernames when indexedDB.databases is missing", async () => {
    // Browsers without indexedDB.databases() only wipe remembered usernames.
    installSession(Date.now() + 3_600_000, Date.now() + 86_400_000);
    await seedOfflineAccount("alice", "contacts");
    const other = offlineDbForAccount("mallory");
    await other.open();
    await other.meta.put({ key: "secret", value: "other-origin-name" });
    const databases = indexedDB.databases.bind(indexedDB);
    Object.defineProperty(indexedDB, "databases", { configurable: true, value: undefined });
    try {
      await wgwLogout();
    } finally {
      Object.defineProperty(indexedDB, "databases", { configurable: true, value: databases });
    }

    const names = await indexedDbNames();
    expect(names).not.toContain("wgw-offline-alice");
    expect(names).toContain("wgw-offline-mallory");
    expect(window.localStorage.getItem("wgw.offline.contacts.username")).toBeNull();
  });

  it("deletes note and document collab rooms, including legacy names", async () => {
    installSession(Date.now() + 3_600_000, Date.now() + 86_400_000);
    await createNamedDatabase("note-uid:v2");
    await createNamedDatabase("note-uid");
    await createNamedDatabase("/note-uid");
    await createNamedDatabase("Docs/private.md:v2");
    await createNamedDatabase("Docs/private.md");
    await createNamedDatabase("/Docs/private.md");
    await createNamedDatabase("orphan-room:v2");
    await createNamedDatabase("fn-doc:v3");
    await createNamedDatabase("report:v2-draft");
    await createNamedDatabase("report:v3-draft");
    await createNamedDatabase("not-wgw-cache");

    await wgwLogout();

    const names = await indexedDbNames();
    expect(names).not.toContain("note-uid:v2");
    expect(names).not.toContain("note-uid");
    expect(names).not.toContain("/note-uid");
    expect(names).not.toContain("Docs/private.md:v2");
    expect(names).not.toContain("Docs/private.md");
    expect(names).not.toContain("/Docs/private.md");
    expect(names).not.toContain("orphan-room:v2");
    expect(names).not.toContain("fn-doc:v3");
    expect(names).toContain("report:v2-draft");
    expect(names).toContain("report:v3-draft");
    expect(names).toContain("not-wgw-cache");
  });

  it("deletes collab rooms recorded in the account when indexedDB.databases is missing", async () => {
    installSession(Date.now() + 3_600_000, Date.now() + 86_400_000);
    await seedOfflineAccount("alice", "notes");
    const db = offlineDbForAccount("alice");
    await notesNotesTable(db).put({
      id: "note-uid",
      notebookId: "nb",
      data: "{}",
      pendingSync: true,
      updatedAt: 1,
    });
    await docsAvailabilityTable(db).put({
      id: "Docs/private.md",
      pinnedAt: 1,
      lastSyncedAt: null,
      location: "My Drive",
      nodeId: "fn-private",
    });
    await createNamedDatabase("note-uid:v2");
    await createNamedDatabase("Docs/private.md:v2");
    await createNamedDatabase("fn-private:v3");
    await createNamedDatabase("orphan-room:v2");
    const databases = indexedDB.databases.bind(indexedDB);
    Object.defineProperty(indexedDB, "databases", { configurable: true, value: undefined });
    try {
      await wgwLogout();
    } finally {
      Object.defineProperty(indexedDB, "databases", { configurable: true, value: databases });
    }

    const names = await indexedDbNames();
    expect(names).not.toContain("wgw-offline-alice");
    expect(names).not.toContain("note-uid:v2");
    expect(names).not.toContain("note-uid");
    expect(names).not.toContain("Docs/private.md:v2");
    expect(names).not.toContain("fn-private:v3");
    expect(names).toContain("orphan-room:v2");
  });

  it("counts outbox rows that logout will discard", async () => {
    rememberOfflineUsername("notes", "alice");
    const db = offlineDbForAccount("alice");
    await db.open();
    await db.outbox.put({
      id: "pending-1",
      domain: "notes",
      op: "update",
      payload: "{}",
      createdAt: 1,
      retries: 0,
    });
    await db.outbox.put({
      id: "pending-2",
      domain: "notes",
      op: "update",
      payload: "{}",
      createdAt: 2,
      retries: 0,
    });

    await expect(countDiscardedUnsyncedChanges()).resolves.toBe(2);
  });

  it("counts an unsaved document body when the outbox is empty", async () => {
    await seedPendingServerSave("Docs/private.md:v2");
    await seedPendingServerSave("Docs/private.md");
    const open = vi.spyOn(indexedDB, "open");
    try {
      await expect(countDiscardedUnsyncedChanges()).resolves.toBe(1);
      const opened = open.mock.calls.map((call) => call[0]);
      expect(opened).toContain("Docs/private.md:v2");
      expect(opened).toContain("Docs/private.md");
      expect(opened).not.toContain("/Docs/private.md");
    } finally {
      open.mockRestore();
    }
  });

  it("does not open collab names that indexedDB.databases does not list", async () => {
    await seedOfflineAccount("alice", "notes");
    const db = offlineDbForAccount("alice");
    await notesNotesTable(db).put({
      id: "cached-note",
      notebookId: "nb",
      data: "{}",
      pendingSync: true,
      updatedAt: 1,
    });
    await seedPendingServerSave("Docs/private.md:v2");
    const open = vi.spyOn(indexedDB, "open");
    try {
      await expect(countDiscardedUnsyncedChanges()).resolves.toBe(1);
      const opened = open.mock.calls.map((call) => call[0]);
      expect(opened).not.toContain("cached-note");
      expect(opened).not.toContain("/cached-note");
      expect(opened).not.toContain("cached-note:v2");
      expect(opened).not.toContain("Docs/private.md");
      expect(opened).not.toContain("/Docs/private.md");
    } finally {
      open.mockRestore();
    }
  });

  it("counts a pending body from the notes table when indexedDB.databases is missing", async () => {
    rememberOfflineUsername("notes", "alice");
    const db = offlineDbForAccount("alice");
    await db.open();
    await notesNotesTable(db).put({
      id: "note-uid",
      notebookId: "nb",
      data: "{}",
      pendingSync: true,
      updatedAt: 1,
    });
    await seedPendingServerSave("note-uid:v2");
    const databases = indexedDB.databases.bind(indexedDB);
    Object.defineProperty(indexedDB, "databases", { configurable: true, value: undefined });
    try {
      await expect(countDiscardedUnsyncedChanges()).resolves.toBe(1);
    } finally {
      Object.defineProperty(indexedDB, "databases", { configurable: true, value: databases });
    }
  });

  it("does not create a database while counting a remembered username that has none", async () => {
    rememberOfflineUsername("notes", "nobody");
    const databases = indexedDB.databases.bind(indexedDB);
    Object.defineProperty(indexedDB, "databases", { configurable: true, value: undefined });
    try {
      await expect(countDiscardedUnsyncedChanges()).resolves.toBe(0);
    } finally {
      Object.defineProperty(indexedDB, "databases", { configurable: true, value: databases });
    }

    expect(await indexedDbNames()).not.toContain("wgw-offline-nobody");
  });

  it("rejects a logout count when indexedDB.open never settles", async () => {
    vi.useFakeTimers();
    rememberOfflineUsername("notes", "alice");
    const databases = indexedDB.databases;
    const open = indexedDB.open.bind(indexedDB);
    Object.defineProperty(indexedDB, "databases", { configurable: true, value: undefined });
    Object.defineProperty(indexedDB, "open", {
      configurable: true,
      value: () => ({
        result: null,
        error: null,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
        onblocked: null,
      }),
    });
    try {
      const pending = countDiscardedUnsyncedChanges();
      const assertion = expect(pending).rejects.toThrow(/timed out/);
      await vi.advanceTimersByTimeAsync(10_000);
      await assertion;
    } finally {
      vi.useRealTimers();
      Object.defineProperty(indexedDB, "databases", { configurable: true, value: databases });
      Object.defineProperty(indexedDB, "open", { configurable: true, value: open });
    }
  });

  it("still deletes the server push row when the push scope store never opens", async () => {
    vi.useFakeTimers();
    const open = indexedDB.open.bind(indexedDB);
    const unsubscribe = vi.fn(async () => true);
    const subscription = { endpoint: "https://push.example/e1", unsubscribe };
    const serviceWorker = {
      getRegistration: async () => ({ pushManager: { getSubscription: async () => subscription } }),
    };
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: serviceWorker });
    Object.defineProperty(indexedDB, "open", {
      configurable: true,
      value: () => ({ result: null, error: null, onsuccess: null, onerror: null }),
    });
    const authorizedFetch = vi.fn(async () => new Response("{}", { status: 200 }));
    try {
      const pending = releasePushOnLogout(authorizedFetch);
      await vi.advanceTimersByTimeAsync(2_500);
      await pending;
      expect(authorizedFetch).toHaveBeenCalledWith(
        "/notifications/push/subscriptions",
        expect.objectContaining({ method: "DELETE" }),
      );
      expect(unsubscribe).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      Object.defineProperty(indexedDB, "open", { configurable: true, value: open });
      delete (navigator as { serviceWorker?: unknown }).serviceWorker;
    }
  });

  it("marks the session logged out before revoke finishes", async () => {
    installSession(Date.now() + 3_600_000, Date.now() + 86_400_000);
    let markerDuringRevoke: string | null = null;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/auth/revoke")) {
        markerDuringRevoke = window.localStorage.getItem(LOGGED_OUT_KEY);
      }
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    await wgwLogout();

    expect(markerDuringRevoke).toBe("1");
    expect(window.localStorage.getItem(LOGGED_OUT_KEY)).toBe("1");
  });

  it("leaves the member cache and push subscription when a guest signs out", async () => {
    const endpoint = "https://push.example.test/subscription/alice";
    const { unsubscribe } = installPushSubscription(endpoint);
    installSession(Date.now() + 3_600_000, Date.now() + 86_400_000);
    await seedOfflineAccount("alice", "calendars");
    await createNamedDatabase("alice-note:v2");
    window.localStorage.setItem(SESSION_KIND_KEY, "guest");
    resetWgwSessionStateForTests();
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    globalThis.fetch = fetchMock as typeof fetch;

    await wgwLogout();

    expect(unsubscribe).not.toHaveBeenCalled();
    expect(fetchCalls(fetchMock).some((call) => isPushDelete(call, endpoint))).toBe(false);
    expect(window.localStorage.getItem("wgw.offline.calendars.username")).toBe("alice");
    expect(await indexedDbNames()).toContain("wgw-offline-alice");
    expect(await indexedDbNames()).toContain("alice-note:v2");
    expect(window.localStorage.getItem(ACCESS_TOKEN_KEY)).toBeNull();
  });

  it("records a logout step failure without skipping later steps", async () => {
    await runLogoutStep(async () => {
      throw new Error("wipe blocked");
    }, "wipe");

    const ring = JSON.parse(window.localStorage.getItem("wgw.api.session_debug") ?? "[]") as Array<{
      event: string;
      step: string;
      message: string;
    }>;
    expect(ring.at(-1)).toMatchObject({
      event: "wgw.logout.step_failed",
      step: "wipe",
      message: "wipe blocked",
    });
  });
});

describe("session loss without logout", () => {
  it("keeps offline data when the refresh token expires", async () => {
    installSession(Date.now() - 60_000, Date.now() - 60_000);
    await seedOfflineAccount("bob", "calendars");
    await createNamedDatabase("bob-note:v2");

    await expect(wgwEnsureSession()).rejects.toThrow(/Missing auth session/);

    expect(window.localStorage.getItem("wgw.offline.calendars.username")).toBe("bob");
    expect(window.localStorage.getItem(LOGGED_OUT_KEY)).toBeNull();
    expect(await indexedDbNames()).toContain("wgw-offline-bob");
    expect(await indexedDbNames()).toContain("bob-note:v2");
    expect(resolveOfflineUsername("calendars", undefined)).toBe("bob");
  });

  it("keeps offline data when the server rejects refresh", async () => {
    installSession(Date.now() - 60_000, Date.now() + 86_400_000);
    await seedOfflineAccount("cara", "notes");
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/auth/refresh")) return new Response("{}", { status: 401 });
      return new Response("unexpected", { status: 500 });
    }) as typeof fetch;

    await expect(wgwEnsureSession()).rejects.toThrow(/Missing auth session/);

    expect(window.localStorage.getItem("wgw.offline.notes.username")).toBe("cara");
    expect(window.localStorage.getItem(LOGGED_OUT_KEY)).toBeNull();
    expect(await indexedDbNames()).toContain("wgw-offline-cara");
    expect(resolveOfflineUsername("notes", undefined)).toBe("cara");
  });
});

describe("resolveOfflineUsername", () => {
  it("returns null for the cached account when the logged-out marker is set", () => {
    rememberOfflineUsername("notes", "alice");
    window.localStorage.setItem(LOGGED_OUT_KEY, "1");

    expect(resolveOfflineUsername("notes", undefined)).toBeNull();
    expect(resolveOfflineUsername("notes", "  ")).toBeNull();
  });

  it("returns the cached account when the user has not logged out", () => {
    rememberOfflineUsername("notes", "alice");

    expect(resolveOfflineUsername("notes", undefined)).toBe("alice");
  });
});
