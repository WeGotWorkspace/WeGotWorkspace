// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchWgwAuthToken } from "@/lib/api/wgw/auth-token";
import { resetWgwSessionStateForTests } from "@/lib/api/wgw/http";

const originalFetch = globalThis.fetch;
const ACCESS_TOKEN_KEY = "wgw.api.access_token";
const REFRESH_TOKEN_KEY = "wgw.api.refresh_token";

function makeJwt(exp: number): string {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  const payload = btoa(JSON.stringify({ exp }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return `${header}.${payload}.signature`;
}

beforeEach(() => {
  window.localStorage.clear();
  resetWgwSessionStateForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  globalThis.fetch = originalFetch;
  window.localStorage.clear();
  resetWgwSessionStateForTests();
});

describe("fetchWgwAuthToken", () => {
  it("returns provided auth token without fetching", async () => {
    await expect(fetchWgwAuthToken({ authToken: "inline-token" })).resolves.toBe("inline-token");
    expect(globalThis.fetch).toBe(originalFetch);
  });

  it("trims whitespace from inline tokens", async () => {
    await expect(fetchWgwAuthToken({ authToken: "  inline-token  " })).resolves.toBe(
      "inline-token",
    );
  });

  it("returns undefined when authTokenUrl is not configured and no session exists", async () => {
    await expect(fetchWgwAuthToken({})).resolves.toBeUndefined();
  });

  it("uses the live session access token when no inline token or authTokenUrl is provided", async () => {
    const token = makeJwt(Math.floor(Date.now() / 1_000) + 3_600);
    window.localStorage.setItem(ACCESS_TOKEN_KEY, token);
    window.localStorage.setItem(REFRESH_TOKEN_KEY, "refresh-token");

    await expect(fetchWgwAuthToken({})).resolves.toBe(token);
    expect(globalThis.fetch).toBe(originalFetch);
  });

  it("throws when credentials are missing", async () => {
    await expect(
      fetchWgwAuthToken({
        authTokenUrl: "https://wegotworkspace.local/api/v1/auth/token",
      }),
    ).rejects.toThrow("Missing auth credentials for authenticated parity story");
  });

  it("returns access_token for successful auth response", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            access_token: "token-123",
            refresh_token: "refresh-123",
            token_type: "Bearer",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    ) as typeof fetch;

    await expect(
      fetchWgwAuthToken({
        authTokenUrl: "https://wegotworkspace.local/api/v1/auth/token",
        authUser: "admin",
        authPassword: "storybook-dev",
      }),
    ).resolves.toBe("token-123");
  });

  it("surfaces API error messages", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "Invalid credentials." }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
    ) as typeof fetch;

    await expect(
      fetchWgwAuthToken({
        authTokenUrl: "https://wegotworkspace.local/api/v1/auth/token",
        authUser: "admin",
        authPassword: "wrong",
      }),
    ).rejects.toThrow("Invalid credentials.");
  });

  it("throws status-based error when response body is not JSON", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("Gateway timeout", { status: 502 }),
    ) as typeof fetch;

    await expect(
      fetchWgwAuthToken({
        authTokenUrl: "https://wegotworkspace.local/api/v1/auth/token",
        authUser: "admin",
        authPassword: "storybook-dev",
      }),
    ).rejects.toThrow("Auth token request failed (502)");
  });

  it("throws when response omits access_token", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ token_type: "Bearer" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ) as typeof fetch;

    await expect(
      fetchWgwAuthToken({
        authTokenUrl: "https://wegotworkspace.local/api/v1/auth/token",
        authUser: "admin",
        authPassword: "storybook-dev",
      }),
    ).rejects.toThrow("Auth token request failed (200)");
  });
});
