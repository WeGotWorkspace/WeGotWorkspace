// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthRefreshLockForTests, withAuthRefreshLock } from "./auth-refresh-lock";
import {
  resetWgwSessionStateForTests,
  wgwAwaitSessionRefreshForReconnect,
  wgwClearGuestShareAccess,
  wgwEnsureFreshAccessToken,
  wgwEnsureSession,
  wgwFetch,
  wgwCompleteLogoutNavigation,
  wgwEstablishGuestShareSession,
  wgwFetchPrincipal,
  wgwGuestSharePath,
  wgwGuestShareToken,
  wgwHasAuthenticatedSession,
  wgwIsGuestSession,
  wgwFetchPasswordRecoveryEnabled,
  wgwLoginWithCredentials,
  wgwEstablishMcpWebSession,
  wgwOAuthSessionUrl,
  wgwRequestPasswordReset,
  wgwResetPasswordWithToken,
  wgwRedirectGuestShareReauth,
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
  Reflect.deleteProperty(navigator, "locks");
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

  it("uses a newer session another tab stored instead of refreshing the rotated token", async () => {
    installSession({
      accessToken: makeJwt(Math.floor(Date.now() / 1_000) - 120),
      refreshToken: "refresh-rotated",
      accessExpiresAt: Date.now() - 60_000,
      refreshExpiresAt: Date.now() + 14 * 24 * 60 * 60_000,
    });
    expect(wgwHasAuthenticatedSession()).toBe(true);

    const freshAccess = makeJwt(Math.floor(Date.now() / 1_000) + 3_600);
    installSession({
      accessToken: freshAccess,
      refreshToken: "refresh-current",
      accessExpiresAt: Date.now() + 50 * 60_000,
      refreshExpiresAt: Date.now() + 14 * 24 * 60 * 60_000,
    });
    const fetchMock = vi.fn(async () => new Response("should-not-refresh", { status: 500 }));
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(wgwEnsureFreshAccessToken()).resolves.toBe(freshAccess);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(REFRESH_TOKEN_KEY)).toBe("refresh-current");
  });

  it("refreshes after a 401 when the stored access token is still inside the client skew window", async () => {
    const rejected = makeJwt(Math.floor(Date.now() / 1_000) + 3_600);
    const renewed = makeJwt(Math.floor(Date.now() / 1_000) + 7_200);
    installSession({
      accessToken: rejected,
      refreshToken: "refresh-old",
      accessExpiresAt: Date.now() + 50 * 60_000,
      refreshExpiresAt: Date.now() + 14 * 24 * 60 * 60_000,
    });

    const fetchMock = vi.fn(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/auth/refresh")) {
        expect(JSON.parse(String(init?.body))).toEqual({ refresh_token: "refresh-old" });
        return new Response(
          JSON.stringify({
            access_token: renewed,
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
      const authorization = new Headers(init?.headers).get("Authorization");
      if (authorization === `Bearer ${rejected}`) {
        return new Response(JSON.stringify({ error: "unauthenticated" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (authorization === `Bearer ${renewed}`) {
        return new Response(JSON.stringify({ username: "alice" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("unexpected", { status: 500 });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const res = await wgwFetch("/me");
    expect(res.status).toBe(200);
    expect(window.localStorage.getItem(REFRESH_TOKEN_KEY)).toBe("refresh-new");
    const refreshPosts = fetchMock.mock.calls.filter((call) =>
      String(call[0]).endsWith("/auth/refresh"),
    );
    expect(refreshPosts).toHaveLength(1);
    const meCalls = fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/me"));
    expect(meCalls).toHaveLength(2);
    expect(new Headers(meCalls[1]?.[1]?.headers).get("Authorization")).toBe(`Bearer ${renewed}`);
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

  it("posts auth refresh once when a second call waits on the Web Locks mutex", async () => {
    installSession({
      accessToken: makeJwt(Math.floor(Date.now() / 1_000) - 120),
      refreshToken: "refresh-old",
      accessExpiresAt: Date.now() - 60_000,
      refreshExpiresAt: Date.now() + 30 * 60_000,
    });

    let chain = Promise.resolve();
    const request = vi.fn(
      (_name: string, _options: LockOptions, callback: () => Promise<boolean>) => {
        const run = chain.then(() => callback());
        chain = run.then(
          () => undefined,
          () => undefined,
        );
        return run;
      },
    );
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: { request },
    });

    let releaseRefresh!: (value: Response) => void;
    const refreshResponse = new Promise<Response>((resolve) => {
      releaseRefresh = resolve;
    });
    const freshAccess = makeJwt(Math.floor(Date.now() / 1_000) + 3_600);
    const fetchMock = vi.fn(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/refresh")) return refreshResponse;
      return new Response("unexpected", { status: 500 });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const first = wgwEnsureFreshAccessToken();
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    resetWgwSessionStateForTests(true);
    resetAuthRefreshLockForTests();
    const second = wgwEnsureFreshAccessToken();
    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledTimes(2);
    });

    releaseRefresh(
      new Response(
        JSON.stringify({
          access_token: freshAccess,
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

    await expect(first).resolves.toBe(freshAccess);
    await expect(second).resolves.toBe(freshAccess);
    expect(request).toHaveBeenCalledWith(
      "wgw-auth-refresh",
      { mode: "exclusive" },
      expect.any(Function),
    );
    const refreshPosts = fetchMock.mock.calls.filter((call) =>
      String(call[0]).endsWith("/auth/refresh"),
    );
    expect(refreshPosts).toHaveLength(1);
  });

  it("does not reload a rotated refresh token after a partial storage write", async () => {
    const freshAccess = makeJwt(Math.floor(Date.now() / 1_000) + 3_600);
    installSession({
      accessToken: makeJwt(Math.floor(Date.now() / 1_000) - 120),
      refreshToken: "refresh-old",
      accessExpiresAt: Date.now() - 60_000,
      refreshExpiresAt: Date.now() + 30 * 60_000,
    });
    const realSetItem = Storage.prototype.setItem;
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === REFRESH_TOKEN_KEY) throw new Error("quota");
      return realSetItem.call(this, key, value);
    });
    globalThis.fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/refresh")) {
        return new Response(
          JSON.stringify({
            access_token: freshAccess,
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

    await expect(wgwEnsureFreshAccessToken()).resolves.toBe(freshAccess);
    expect(window.localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull();
    setItem.mockRestore();

    const secondFetch = vi.fn(async () => new Response("should-not-refresh", { status: 500 }));
    globalThis.fetch = secondFetch as typeof fetch;
    await expect(wgwEnsureFreshAccessToken()).resolves.toBe(freshAccess);
    expect(secondFetch).not.toHaveBeenCalled();
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

describe("password recovery helpers", () => {
  it("reads auth.passwordRecovery from capabilities", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ auth: { passwordRecovery: true } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    await expect(wgwFetchPasswordRecoveryEnabled()).resolves.toBe(true);
  });

  it("posts identifier to password-resets", async () => {
    const fetchMock = vi.fn(async (_input, _init) => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(wgwRequestPasswordReset(" alice@example.test ")).resolves.toBeUndefined();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/auth/password-resets");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      identifier: "alice@example.test",
    });
  });

  it("posts a new password to the token path", async () => {
    const fetchMock = vi.fn(async (_input) => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(wgwResetPasswordWithToken("abc", "newpassword12")).resolves.toBeUndefined();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/auth/password-resets/abc");
  });

  it("rejects short passwords before calling the API", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    await expect(wgwResetPasswordWithToken("abc", "short")).rejects.toThrow(
      /at least 10 characters/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
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

describe("MCP OAuth web session", () => {
  it("posts credentials to /oauth/session with the intent token", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ ok: true, redirect: "/oauth/authorize?client_id=a" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(wgwEstablishMcpWebSession("bob", "secret", "intent-token")).resolves.toBe(
      "/oauth/authorize?client_id=a",
    );
    expect(fetchMock).toHaveBeenCalledWith("/oauth/session", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username: "bob", password: "secret", intent: "intent-token" }),
    });
  });

  it("maps invalid credentials from /oauth/session", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ error: "Those credentials were not recognized." }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    await expect(wgwEstablishMcpWebSession("bob", "wrong")).rejects.toThrow(
      "Those credentials were not recognized.",
    );
  });

  it("resolves the session URL from an absolute API base", () => {
    vi.stubEnv("VITE_WGW_API_BASE_URL", "https://workspace.example/api/v1");
    expect(wgwOAuthSessionUrl()).toBe("https://workspace.example/oauth/session");
    vi.stubEnv("VITE_WGW_API_BASE_URL", "");
  });
});

describe("guest share session", () => {
  it("stores guest JWT with sentinel refresh token", () => {
    const accessToken = makeJwt(Math.floor(Date.now() / 1_000) + 3600, {
      sub: "share:abc123",
      role: "guest",
    });
    wgwEstablishGuestShareSession(
      { access_token: accessToken, expires_in: 3600 },
      "share-token-1",
      "/users/bob/contacts.vcf",
    );

    expect(wgwHasAuthenticatedSession()).toBe(true);
    expect(wgwIsGuestSession()).toBe(true);
    expect(window.localStorage.getItem(REFRESH_TOKEN_KEY)).toBe(WGW_GUEST_REFRESH_TOKEN);
    expect(window.localStorage.getItem(ACCESS_TOKEN_KEY)).toBe(accessToken);
    expect(window.sessionStorage.getItem("wgw.api.guest_share_token")).toBe("share-token-1");
    expect(window.sessionStorage.getItem("wgw.api.guest_share_path")).toBe(
      "/users/bob/contacts.vcf",
    );
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

  it("clears guest access tokens while keeping the public share token", () => {
    const accessToken = makeJwt(Math.floor(Date.now() / 1_000) + 3600, {
      sub: "share:abc123",
      role: "guest",
    });
    wgwEstablishGuestShareSession(
      { access_token: accessToken, expires_in: 3600 },
      "share-token-1",
      "/users/bob/note.md",
    );

    wgwClearGuestShareAccess();

    expect(wgwHasAuthenticatedSession()).toBe(false);
    expect(wgwIsGuestSession()).toBe(false);
    expect(wgwGuestShareToken()).toBe("share-token-1");
    expect(wgwGuestSharePath()).toBeNull();
  });

  it("redirects revoked guests back to the public share password gate", () => {
    const accessToken = makeJwt(Math.floor(Date.now() / 1_000) + 3600, {
      sub: "share:abc123",
      role: "guest",
    });
    wgwEstablishGuestShareSession(
      { access_token: accessToken, expires_in: 3600 },
      "share-token-1",
      "/users/bob/note.md",
    );

    const assign = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { assign },
    });

    expect(wgwRedirectGuestShareReauth()).toBe(true);
    expect(assign).toHaveBeenCalledWith("/share/share-token-1");
    expect(wgwHasAuthenticatedSession()).toBe(false);
    expect(wgwGuestShareToken()).toBe("share-token-1");
  });
});
