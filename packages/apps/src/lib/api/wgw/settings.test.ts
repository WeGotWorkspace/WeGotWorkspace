// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveSettingsProfile } from "@/lib/api/wgw/settings";
import { resetWgwSessionStateForTests, WGW_GUEST_REFRESH_TOKEN } from "@/lib/api/wgw/http";

const ACCESS_TOKEN_KEY = "wgw.api.access_token";
const REFRESH_TOKEN_KEY = "wgw.api.refresh_token";
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

function installSession(refreshToken: string): void {
  const expiresAt = Date.now() + 60 * 60_000;
  window.localStorage.setItem(ACCESS_TOKEN_KEY, makeJwt(Math.floor(Date.now() / 1_000) + 3600));
  window.localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  window.localStorage.setItem(ACCESS_EXPIRES_AT_KEY, String(expiresAt));
  window.localStorage.setItem(REFRESH_EXPIRES_AT_KEY, String(expiresAt));
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
      mail: { imapUsername: "", imapHasPassword: false },
      mailServer: {
        imapHost: "imap.example.test",
        imapPort: 993,
        imapSecurity: "ssl",
        smtpHost: "smtp.example.test",
        smtpPort: 587,
        smtpSecurity: "starttls",
      },
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
  it("sends the current refresh token when the password changes", async () => {
    installSession("refresh-current");
    const fetchMock = vi.fn(async () => settingsStateResponse());
    globalThis.fetch = fetchMock as typeof fetch;

    await saveSettingsProfile({
      displayName: "Alice Example",
      password: "newpassword12",
      currentPassword: "secret",
    });

    expect(profileRequestBody(fetchMock)).toMatchObject({
      displayName: "Alice Example",
      password: "newpassword12",
      currentPassword: "secret",
      refreshToken: "refresh-current",
    });
  });

  it("omits refreshToken when the password is unchanged", async () => {
    installSession("refresh-current");
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
    installSession(WGW_GUEST_REFRESH_TOKEN);
    const fetchMock = vi.fn(async () => settingsStateResponse());
    globalThis.fetch = fetchMock as typeof fetch;

    await saveSettingsProfile({
      displayName: "Guest",
      password: "newpassword12",
      currentPassword: "secret",
    });

    expect(profileRequestBody(fetchMock)).not.toHaveProperty("refreshToken");
  });
});
