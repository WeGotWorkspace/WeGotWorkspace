// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveSettingsProfile } from "@/lib/api/wgw/settings";
import { resetWgwSessionStateForTests } from "@/lib/api/wgw/http";

const ACCESS_TOKEN_KEY = "wgw.api.access_token";
const SESSION_KIND_KEY = "wgw.api.session_kind";
const ACCESS_EXPIRES_AT_KEY = "wgw.api.access_expires_at";
const REFRESH_EXPIRES_AT_KEY = "wgw.api.refresh_expires_at";

const originalFetch = globalThis.fetch;

function base64url(value: string): string {
  const encoded = btoa(unescape(encodeURIComponent(value)));
  return encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function makeJwt(exp: number): string {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ exp }));
  return `${header}.${payload}.signature`;
}

function installSession(sessionKind: "member" | "guest" = "member"): void {
  const expiresAt = Date.now() + 60 * 60_000;
  window.localStorage.setItem(ACCESS_TOKEN_KEY, makeJwt(Math.floor(Date.now() / 1_000) + 3600));
  window.localStorage.setItem(SESSION_KIND_KEY, sessionKind);
  window.localStorage.setItem(ACCESS_EXPIRES_AT_KEY, String(expiresAt));
  window.localStorage.setItem(REFRESH_EXPIRES_AT_KEY, String(expiresAt));
}

/** Access token still valid, but inside the 180s client refresh margin. */
function installSessionInsideRefreshMargin(): void {
  const accessTtlMs = 60_000;
  const expiresAt = Date.now() + accessTtlMs;
  window.localStorage.setItem(ACCESS_TOKEN_KEY, makeJwt(Math.floor(Date.now() / 1_000) + 60));
  window.localStorage.setItem(SESSION_KIND_KEY, "member");
  window.localStorage.setItem(ACCESS_EXPIRES_AT_KEY, String(expiresAt));
  window.localStorage.setItem(REFRESH_EXPIRES_AT_KEY, String(Date.now() + 14 * 24 * 60 * 60_000));
}

function settingsStateResponse(): Response {
  return new Response(
    JSON.stringify({
      user: {
        username: "alice",
        displayName: "Alice Example",
        email: "alice@example.test",
      },
      groups: [],
      logoutUrl: "/api/v1/auth/logout",
      mcpEnabled: false,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function profileRequestBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const call = fetchMock.mock.calls.find((entry) => String(entry[0]).includes("/settings/profile"));
  expect(call).toBeTruthy();
  return JSON.parse(String((call?.[1] as RequestInit).body)) as Record<string, unknown>;
}

beforeEach(() => {
  window.localStorage.clear();
  resetWgwSessionStateForTests();
  vi.restoreAllMocks();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetWgwSessionStateForTests();
  window.localStorage.clear();
});

describe("saveSettingsProfile", () => {
  it("sends the profile body without a refresh token when the password changes", async () => {
    installSession("member");
    const fetchMock = vi.fn(async () => settingsStateResponse());
    globalThis.fetch = fetchMock as typeof fetch;

    await saveSettingsProfile({
      displayName: "Alice Example",
      password: "newpassword12",
      currentPassword: "secret",
    });

    const body = profileRequestBody(fetchMock);
    expect(body).toMatchObject({
      displayName: "Alice Example",
      password: "newpassword12",
      currentPassword: "secret",
    });
    expect(body).not.toHaveProperty("refreshToken");
  });

  it("omits refreshToken when the password is unchanged", async () => {
    installSession("member");
    const fetchMock = vi.fn(async () => settingsStateResponse());
    globalThis.fetch = fetchMock as typeof fetch;

    await saveSettingsProfile({
      displayName: "Alice Example",
      email: "alice@example.test",
    });

    const body = profileRequestBody(fetchMock);
    expect(body).toMatchObject({
      displayName: "Alice Example",
      email: "alice@example.test",
    });
    expect(body).not.toHaveProperty("refreshToken");
  });

  it("omits refreshToken for a guest session even when the password changes", async () => {
    installSession("guest");
    const fetchMock = vi.fn(async () => settingsStateResponse());
    globalThis.fetch = fetchMock as typeof fetch;

    await saveSettingsProfile({
      displayName: "Guest",
      password: "newpassword12",
      currentPassword: "secret",
    });

    expect(profileRequestBody(fetchMock)).not.toHaveProperty("refreshToken");
  });

  it("refreshes inside the access-token margin and still omits refreshToken", async () => {
    installSessionInsideRefreshMargin();
    const rotatedAccess = makeJwt(Math.floor(Date.now() / 1_000) + 3600);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/auth/refresh")) {
        return new Response(
          JSON.stringify({
            access_token: rotatedAccess,
            expires_in: 3600,
            refresh_expires_in: 1209600,
            token_type: "Bearer",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/settings/profile")) return settingsStateResponse();
      return new Response("unexpected", { status: 500 });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    await saveSettingsProfile({
      displayName: "Alice Example",
      password: "newpassword12",
      currentPassword: "secret",
    });

    const body = profileRequestBody(fetchMock);
    expect(body).toMatchObject({
      displayName: "Alice Example",
      password: "newpassword12",
      currentPassword: "secret",
    });
    expect(body).not.toHaveProperty("refreshToken");
  });
});
