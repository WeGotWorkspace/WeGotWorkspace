// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthRefreshLockForTests, withAuthRefreshLock } from "./auth-refresh-lock";
import {
  resetWgwSessionStateForTests,
  wgwAwaitSessionRefreshForReconnect,
  wgwEnsureFreshAccessToken,
  wgwEnsureSession,
  wgwCompleteLogoutNavigation,
  wgwEstablishGuestShareSession,
  wgwFetchPrincipal,
  wgwGuestShareToken,
  wgwHasAuthenticatedSession,
  wgwIsGuestSession,
  wgwLoginWithCredentials,
  wgwRefreshInFlight,
  WGW_GUEST_REFRESH_TOKEN,
} from "./http";
import { decodeJwtExp } from "./jwt-exp";

const ACCESS_TOKEN_KEY = "wgw.api.access_token";
const REFRESH_TOKEN_KEY = "wgw.api.refresh_token";
const ACCESS_EXPIRES_AT_KEY = "wgw.api.access_expires_at";
const REFRESH_EXPIRES_AT_KEY = "wgw.api.refresh_expires_at";
const REFRESH_LOCK_KEY = "wgw.api.refresh.lock";

const originalFetch = globalThis.fetch;
const onlineState = { value: true };

function base64url(value: string): string {
  const encoded = btoa(unescape(encodeURIComponent(value)));
  return encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function makeJwt(exp: number, extra: Record<string, unknown> = {}): string {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ exp, ...extra }));
  return `${header}.${payload}.signature`;
}

function setOnline(next: boolean): void {
  onlineState.value = next;
}

function installSession({
  accessToken,
  refreshToken = "refresh-token",
  accessExpiresAt,
  refreshExpiresAt,
}: {
  accessToken: string;
  refreshToken?: string;
  accessExpiresAt?: number;
  refreshExpiresAt?: number;
}): void {
  window.localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  window.localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  if (accessExpiresAt !== undefined) {
    window.localStorage.setItem(ACCESS_EXPIRES_AT_KEY, String(accessExpiresAt));
  } else {
    window.localStorage.removeItem(ACCESS_EXPIRES_AT_KEY);
  }
  if (refreshExpiresAt !== undefined) {
    window.localStorage.setItem(REFRESH_EXPIRES_AT_KEY, String(refreshExpiresAt));
  } else {
    window.localStorage.removeItem(REFRESH_EXPIRES_AT_KEY);
  }
}

beforeEach(() => {
  vi.stubEnv("VITE_WGW_USE_LIVE_API", "1");
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    get: () => onlineState.value,
  });
  setOnline(true);
  window.localStorage.clear();
  window.sessionStorage.clear();
  resetAuthRefreshLockForTests();
  resetWgwSessionStateForTests();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
  globalThis.fetch = originalFetch;
  resetAuthRefreshLockForTests();
  resetWgwSessionStateForTests();
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("decodeJwtExp", () => {
  it("decodes exp from base64url payload", () => {
    const token = makeJwt(1_900_000_000, { note: "a-b_c" });
    expect(decodeJwtExp(token)).toBe(1_900_000_000);
  });

  it("returns null for malformed tokens", () => {
    expect(decodeJwtExp("not-a-jwt")).toBeNull();
    expect(decodeJwtExp("a.b.c")).toBeNull();
  });
});

describe("wgw auth refresh behavior", () => {
  it("refreshes expired access token during ensureSession", async () => {
    installSession({
      accessToken: makeJwt(Math.floor(Date.now() / 1_000) - 100),
      refreshToken: "refresh-old",
      accessExpiresAt: Date.now() - 60_000,
      refreshExpiresAt: Date.now() + 30 * 60_000,
    });

    globalThis.fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/refresh")) {
        return new Response(
          JSON.stringify({
            access_token: makeJwt(Math.floor(Date.now() / 1_000) + 3600),
            refresh_token: "refresh-new",
            expires_in: 3600,
            refresh_expires_in: 1209600,
            token_type: "Bearer",
            username: "alice",
            role: "user",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("unexpected", { status: 500 });
    }) as typeof fetch;

    await expect(wgwEnsureSession()).resolves.toBeUndefined();
    expect(window.localStorage.getItem(REFRESH_TOKEN_KEY)).toBe("refresh-new");
  });

  it("coalesces concurrent refresh calls in one tab", async () => {
    installSession({
      accessToken: makeJwt(Math.floor(Date.now() / 1_000) - 60),
      refreshToken: "refresh-old",
      accessExpiresAt: Date.now() - 60_000,
      refreshExpiresAt: Date.now() + 30 * 60_000,
    });

    let resolveRefresh!: (value: Response) => void;
    const refreshResponse = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });
    const fetchMock = vi.fn(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/refresh")) return refreshResponse;
      return new Response("unexpected", { status: 500 });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const one = wgwEnsureFreshAccessToken();
    const two = wgwEnsureFreshAccessToken();
    expect(wgwRefreshInFlight()).not.toBeNull();

    resolveRefresh(
      new Response(
        JSON.stringify({
          access_token: makeJwt(Math.floor(Date.now() / 1_000) + 3600),
          refresh_token: "refresh-new",
          expires_in: 3600,
          refresh_expires_in: 1209600,
          token_type: "Bearer",
          username: "alice",
          role: "user",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await Promise.all([one, two]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reloads storage after another tab refreshes during lock wait", async () => {
    vi.useFakeTimers();
    installSession({
      accessToken: makeJwt(Math.floor(Date.now() / 1_000) - 120),
      refreshToken: "refresh-stale",
      accessExpiresAt: Date.now() - 60_000,
      refreshExpiresAt: Date.now() + 30 * 60_000,
    });
    expect(wgwHasAuthenticatedSession()).toBe(true);

    window.localStorage.setItem(
      REFRESH_LOCK_KEY,
      JSON.stringify({ owner: "other-tab", acquiredAt: Date.now() }),
    );
    const fetchMock = vi.fn(async () => new Response("unexpected", { status: 500 }));
    globalThis.fetch = fetchMock as typeof fetch;

    const refreshedInOtherTabAccessToken = makeJwt(Math.floor(Date.now() / 1_000) - 30);
    const promise = wgwEnsureFreshAccessToken();

    vi.advanceTimersByTime(1_000);
    installSession({
      accessToken: refreshedInOtherTabAccessToken,
      refreshToken: "refresh-new",
      accessExpiresAt: Date.now() + 30 * 60_000,
      refreshExpiresAt: Date.now() + 60 * 60_000,
    });
    window.localStorage.removeItem(REFRESH_LOCK_KEY);
    const storageEvent = new StorageEvent("storage");
    Object.defineProperty(storageEvent, "key", { value: REFRESH_LOCK_KEY });
    window.dispatchEvent(storageEvent);
    vi.runAllTimers();

    await expect(promise).resolves.toBe(refreshedInOtherTabAccessToken);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reclaims stale refresh lock after timeout window", async () => {
    window.localStorage.setItem(
      REFRESH_LOCK_KEY,
      JSON.stringify({ owner: "stale-tab", acquiredAt: Date.now() - 31_000 }),
    );
    let ran = false;
    await expect(
      withAuthRefreshLock(async () => {
        ran = true;
        return true;
      }),
    ).resolves.toBe(true);
    expect(ran).toBe(true);
  });

  it("never clears session when offline refresh fails", async () => {
    setOnline(false);
    installSession({
      accessToken: makeJwt(Math.floor(Date.now() / 1_000) - 100),
      refreshToken: "refresh-offline",
      accessExpiresAt: Date.now() - 60_000,
    });
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;

    await expect(wgwEnsureFreshAccessToken()).resolves.toBeTruthy();
    expect(wgwHasAuthenticatedSession()).toBe(true);
  });

  it("keeps session when retry cap hits with unknown refresh expiry", async () => {
    setOnline(true);
    installSession({
      accessToken: makeJwt(Math.floor(Date.now() / 1_000) - 100),
      refreshToken: "refresh-unknown-expiry",
      accessExpiresAt: Date.now() - 60_000,
    });
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;

    for (let i = 0; i < 3; i += 1) {
      await expect(wgwEnsureFreshAccessToken()).rejects.toThrow("Missing auth session");
    }

    expect(wgwHasAuthenticatedSession()).toBe(true);
  });

  it("clears session on refresh 401 while online", async () => {
    installSession({
      accessToken: makeJwt(Math.floor(Date.now() / 1_000) - 100),
      refreshToken: "refresh-invalid",
      accessExpiresAt: Date.now() - 60_000,
      refreshExpiresAt: Date.now() + 60_000,
    });
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ error: "Invalid refresh token." }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    await expect(wgwEnsureFreshAccessToken()).rejects.toThrow("Missing auth session");
    expect(wgwHasAuthenticatedSession()).toBe(false);
  });

  it("awaits in-flight refresh before reconnect flush", async () => {
    installSession({
      accessToken: makeJwt(Math.floor(Date.now() / 1_000) - 100),
      refreshToken: "refresh-old",
      accessExpiresAt: Date.now() - 60_000,
      refreshExpiresAt: Date.now() + 30 * 60_000,
    });

    let resolveRefresh!: (value: Response) => void;
    const refreshResponse = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });

    const fetchMock = vi.fn(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/refresh")) {
        return refreshResponse;
      }
      return new Response("unexpected", { status: 500 });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const refreshing = wgwEnsureFreshAccessToken();
    const gate = wgwAwaitSessionRefreshForReconnect();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveRefresh(
      new Response(
        JSON.stringify({
          access_token: makeJwt(Math.floor(Date.now() / 1_000) + 3600),
          refresh_token: "refresh-new",
          expires_in: 3600,
          refresh_expires_in: 1209600,
          token_type: "Bearer",
          username: "alice",
          role: "user",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await Promise.all([refreshing, gate]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("login applies refresh expiry metadata", () => {
  it("stores refresh_expires_in on token issuance", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          access_token: makeJwt(Math.floor(Date.now() / 1_000) + 3600),
          refresh_token: "refresh-new",
          expires_in: 3600,
          refresh_expires_in: 1209600,
          token_type: "Bearer",
          username: "alice",
          role: "user",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    await expect(wgwLoginWithCredentials("alice", "secret")).resolves.toBeUndefined();
    expect(Number(window.localStorage.getItem(REFRESH_EXPIRES_AT_KEY))).toBeGreaterThan(Date.now());
  });
});

describe("guest share session", () => {
  it("stores guest JWT with sentinel refresh token", () => {
    const accessToken = makeJwt(Math.floor(Date.now() / 1_000) + 3600, {
      sub: "share:abc123",
      role: "guest",
    });
    wgwEstablishGuestShareSession({ access_token: accessToken, expires_in: 3600 });

    expect(wgwHasAuthenticatedSession()).toBe(true);
    expect(wgwIsGuestSession()).toBe(true);
    expect(window.localStorage.getItem(REFRESH_TOKEN_KEY)).toBe(WGW_GUEST_REFRESH_TOKEN);
    expect(window.localStorage.getItem(ACCESS_TOKEN_KEY)).toBe(accessToken);
  });

  it("resolves guest principal without calling /me", async () => {
    const accessToken = makeJwt(Math.floor(Date.now() / 1_000) + 3600, {
      sub: "share:deadbeef",
      role: "guest",
    });
    wgwEstablishGuestShareSession({ access_token: accessToken, expires_in: 3600 });

    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(wgwFetchPrincipal()).resolves.toMatchObject({
      user: {
        displayName: "Guest",
        username: "share:deadbeef",
      },
      viewerInboxLabel: "guest",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not attempt refresh for expired guest sessions", async () => {
    const accessToken = makeJwt(Math.floor(Date.now() / 1_000) - 100, {
      sub: "share:expired",
      role: "guest",
    });
    wgwEstablishGuestShareSession({ access_token: accessToken, expires_in: -100 });

    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(wgwEnsureSession()).rejects.toThrow("Share session expired");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(wgwHasAuthenticatedSession()).toBe(false);
  });

  it("persists the public share token for guest sign-out navigation", () => {
    const accessToken = makeJwt(Math.floor(Date.now() / 1_000) + 3600, {
      sub: "share:abc123",
      role: "guest",
    });
    wgwEstablishGuestShareSession({ access_token: accessToken, expires_in: 3600 }, "share-token-1");

    expect(wgwGuestShareToken()).toBe("share-token-1");
  });

  it("returns guest viewers to the public share route on sign out", async () => {
    const accessToken = makeJwt(Math.floor(Date.now() / 1_000) + 3600, {
      sub: "share:abc123",
      role: "guest",
    });
    wgwEstablishGuestShareSession({ access_token: accessToken, expires_in: 3600 }, "share-token-1");

    const assign = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { assign },
    });

    globalThis.fetch = vi.fn(async () => new Response("{}", { status: 200 })) as typeof fetch;

    await expect(wgwCompleteLogoutNavigation()).resolves.toBe("guest_share");
    expect(assign).toHaveBeenCalledWith("/share/share-token-1");
    expect(wgwHasAuthenticatedSession()).toBe(false);
  });
});
