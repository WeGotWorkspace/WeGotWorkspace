// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadCalendarDirectoryGroups } from "@/lib/api/wgw/calendar";
import { resetWgwSessionStateForTests, wgwFetchPrincipal } from "@/lib/api/wgw/http";
import { fetchSettingsLiveBootstrap, saveSettingsProfile } from "@/lib/api/wgw/settings";
import { resetCrossTabLockForTests } from "@/lib/cross-tab/cross-tab-lock";

const originalFetch = globalThis.fetch;

function base64url(value: string): string {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function installSession(): void {
  const exp = Math.floor(Date.now() / 1_000) + 3600;
  const jwt = `${base64url('{"alg":"HS256"}')}.${base64url(JSON.stringify({ exp, sub: "alice" }))}.sig`;
  const at = Date.now() + 60 * 60_000;
  window.localStorage.setItem("wgw.api.access_token", jwt);
  window.localStorage.setItem("wgw.api.session_kind", "member");
  window.localStorage.setItem("wgw.api.access_expires_at", String(at));
  window.localStorage.setItem("wgw.api.refresh_expires_at", String(at));
}

const state = (locale: string) => ({
  user: { username: "alice", displayName: "Alice", email: "alice@example.test" },
  groups: [{ id: "g1", displayName: "Team" }],
  logoutUrl: "/api/v1/auth/logout",
  mcpEnabled: false,
  locale,
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("shared /settings/state and /me reads", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const calls = (needle: string) =>
    fetchMock.mock.calls.filter((c) => String(c[0]).endsWith(needle)).length;

  beforeEach(() => {
    window.localStorage.clear();
    resetCrossTabLockForTests();
    resetWgwSessionStateForTests();
    installSession();
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/settings/profile") && init?.method) return json(state("nl"));
      if (url.endsWith("/settings/state")) return json(state("en"));
      if (url.endsWith("/me")) return json({ username: "alice", mfa: { enabled: false } });
      return new Response("{}", { status: 404 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("five concurrent app bootstraps cause one /settings/state and one /me request", async () => {
    await Promise.all([
      wgwFetchPrincipal(),
      wgwFetchPrincipal(),
      loadCalendarDirectoryGroups(),
      wgwFetchPrincipal(),
      fetchSettingsLiveBootstrap(),
    ]);
    await wgwFetchPrincipal();
    expect(calls("/settings/state")).toBe(1);
    expect(calls("/me")).toBe(1);
  });

  it("a settings write replaces the shared value for every later reader without a new read", async () => {
    expect((await fetchSettingsLiveBootstrap()).data.user.username).toBe("alice");
    await saveSettingsProfile({ displayName: "Alice B" } as never);
    const groups = await loadCalendarDirectoryGroups();
    expect(groups).toHaveLength(1);
    expect(calls("/settings/state")).toBe(1);
    // /me can carry what the write changed, so it is read again, once.
    await wgwFetchPrincipal();
    await wgwFetchPrincipal();
    expect(calls("/me")).toBe(2);
  });
});
