import { describe, expect, it, vi } from "vitest";
import { loginRouteBeforeLoad } from "@/wegotworkspace/src/wegotworkspace-login-route";

vi.mock("@/lib/api/wgw/http", () => ({
  wgwLiveApiEnabled: vi.fn(() => true),
  wgwHasAuthenticatedSession: vi.fn(() => true),
}));

import { wgwHasAuthenticatedSession, wgwLiveApiEnabled } from "@/lib/api/wgw/http";

describe("loginRouteBeforeLoad", () => {
  it("redirects authenticated users to the return path", () => {
    vi.mocked(wgwLiveApiEnabled).mockReturnValue(true);
    vi.mocked(wgwHasAuthenticatedSession).mockReturnValue(true);

    try {
      loginRouteBeforeLoad({ search: { return: "/docs" } });
      expect.unreachable("expected redirect throw");
    } catch (error) {
      expect(error).toMatchObject({ options: { to: "/docs" } });
    }
  });

  it("no-ops when unauthenticated", () => {
    vi.mocked(wgwLiveApiEnabled).mockReturnValue(true);
    vi.mocked(wgwHasAuthenticatedSession).mockReturnValue(false);

    expect(() => loginRouteBeforeLoad({ search: { return: "/docs" } })).not.toThrow();
  });

  it("does not skip the form for oauth authorize when only a SPA JWT exists", () => {
    vi.mocked(wgwLiveApiEnabled).mockReturnValue(true);
    vi.mocked(wgwHasAuthenticatedSession).mockReturnValue(true);

    expect(() =>
      loginRouteBeforeLoad({ search: { return: "/oauth/authorize?client_id=abc" } }),
    ).not.toThrow();
  });
});
