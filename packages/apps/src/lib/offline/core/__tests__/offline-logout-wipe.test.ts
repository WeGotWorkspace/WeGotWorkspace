// @vitest-environment jsdom
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetWgwSessionStateForTests, wgwEnsureSession, wgwLogout } from "@/lib/api/wgw/http";
import {
  rememberOfflineUsername,
  resolveOfflineUsername,
} from "@/lib/offline/core/offline-account";
import { offlineDbForAccount } from "@/lib/offline/core/offline-db";

const ACCESS_TOKEN_KEY = "wgw.api.access_token";
const REFRESH_TOKEN_KEY = "wgw.api.refresh_token";
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
  window.localStorage.setItem(REFRESH_TOKEN_KEY, "refresh-token");
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
});

describe("session loss without logout", () => {
  it("keeps offline data when the refresh token expires", async () => {
    installSession(Date.now() - 60_000, Date.now() - 60_000);
    await seedOfflineAccount("bob", "calendars");

    await expect(wgwEnsureSession()).rejects.toThrow(/Missing auth session/);

    expect(window.localStorage.getItem("wgw.offline.calendars.username")).toBe("bob");
    expect(window.localStorage.getItem(LOGGED_OUT_KEY)).toBeNull();
    expect(await indexedDbNames()).toContain("wgw-offline-bob");
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
