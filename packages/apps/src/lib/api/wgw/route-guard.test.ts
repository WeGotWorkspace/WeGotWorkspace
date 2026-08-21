import { describe, expect, it, vi } from "vitest";
import {
  buildWgwLoginHref,
  isWgwAuthRoutePathname,
  isWgwPublicRoutePathname,
  requireWgwAuth,
  resolveWgwSameOriginHref,
  sanitizeWgwReturnPath,
} from "@/lib/api/wgw/route-guard";

vi.mock("@/lib/api/wgw/http", () => ({
  wgwLiveApiEnabled: vi.fn(() => true),
  wgwHasAuthenticatedSession: vi.fn(() => false),
}));

import { wgwHasAuthenticatedSession, wgwLiveApiEnabled } from "@/lib/api/wgw/http";

describe("isWgwAuthRoutePathname", () => {
  it("detects login and logout routes", () => {
    expect(isWgwAuthRoutePathname("/login")).toBe(true);
    expect(isWgwAuthRoutePathname("/login/forgot")).toBe(true);
    expect(isWgwAuthRoutePathname("/login/reset")).toBe(true);
    expect(isWgwAuthRoutePathname("/logout/confirm")).toBe(true);
    expect(isWgwAuthRoutePathname("/mail")).toBe(false);
  });

  it("normalizes duplicate slashes and trailing slashes", () => {
    expect(isWgwAuthRoutePathname("//login//")).toBe(true);
  });
});

describe("isWgwPublicRoutePathname", () => {
  it("detects share and meet guest routes", () => {
    expect(isWgwPublicRoutePathname("/share/demo-token")).toBe(true);
    expect(isWgwPublicRoutePathname("/meet/guest")).toBe(true);
    expect(isWgwPublicRoutePathname("/drive")).toBe(false);
  });
});

describe("sanitizeWgwReturnPath", () => {
  it("allows product routes and preserves query/hash", () => {
    expect(sanitizeWgwReturnPath("/mail?folder=inbox#top")).toBe("/mail?folder=inbox#top");
    expect(sanitizeWgwReturnPath("/drive/My%20Drive")).toBe("/drive/My%20Drive");
    expect(sanitizeWgwReturnPath("/apps/office/")).toBe("/apps/office");
    expect(sanitizeWgwReturnPath("/contacts")).toBe("/contacts");
    expect(sanitizeWgwReturnPath("/tasks/inbox")).toBe("/tasks/inbox");
    expect(sanitizeWgwReturnPath("/calendar/week/2026-08-17")).toBe("/calendar/week/2026-08-17");
    expect(sanitizeWgwReturnPath("/calendar/list/month/2026-08-17")).toBe(
      "/calendar/list/month/2026-08-17",
    );
  });

  it("rejects external and unknown paths", () => {
    expect(sanitizeWgwReturnPath("//evil.com/phish")).toBe("/");
    expect(sanitizeWgwReturnPath("/unknown-app")).toBe("/");
    expect(sanitizeWgwReturnPath(null)).toBe("/");
  });

  it("unwraps nested login return chains", () => {
    const nested = "/login?return=" + encodeURIComponent("/login?return=%2Fmail");
    expect(sanitizeWgwReturnPath(nested)).toBe("/mail");
  });

  it("preserves plugin app return paths after unwrap", () => {
    const nested =
      "/login?return=" + encodeURIComponent("/login?return=" + encodeURIComponent("/apps/office"));
    expect(sanitizeWgwReturnPath(nested)).toBe("/apps/office");
  });
});

describe("buildWgwLoginHref", () => {
  it("returns bare login path for home", () => {
    expect(buildWgwLoginHref("/")).toBe("/login");
  });

  it("encodes safe return destinations", () => {
    expect(buildWgwLoginHref("/notes?page=2")).toBe("/login?return=%2Fnotes%3Fpage%3D2");
  });
});

describe("resolveWgwSameOriginHref", () => {
  it("keeps relative app paths", () => {
    expect(resolveWgwSameOriginHref("/logout", "/login")).toBe("/logout");
    expect(resolveWgwSameOriginHref("/login?return=%2Fadmin", "/logout")).toBe(
      "/login?return=%2Fadmin",
    );
  });

  it("keeps same-origin absolute URLs as a path", () => {
    vi.stubGlobal("window", { location: { origin: "http://localhost:5194" } });
    expect(resolveWgwSameOriginHref("http://localhost:5194/logout", "/login")).toBe("/logout");
    vi.unstubAllGlobals();
  });

  it("falls back when the API bind host differs from the SPA", () => {
    expect(resolveWgwSameOriginHref("http://127.0.0.1:9080/logout", "/logout")).toBe("/logout");
    expect(resolveWgwSameOriginHref("https://evil.example/logout", "/logout")).toBe("/logout");
    expect(resolveWgwSameOriginHref("//evil.example/logout", "/logout")).toBe("/logout");
    expect(resolveWgwSameOriginHref(null, "/logout")).toBe("/logout");
  });
});

describe("requireWgwAuth", () => {
  it("no-ops when live API is disabled", () => {
    vi.mocked(wgwLiveApiEnabled).mockReturnValueOnce(false);
    expect(() => requireWgwAuth({ pathname: "/mail" })).not.toThrow();
  });

  it("no-ops when session exists", () => {
    vi.mocked(wgwLiveApiEnabled).mockReturnValueOnce(true);
    vi.mocked(wgwHasAuthenticatedSession).mockReturnValueOnce(true);
    expect(() => requireWgwAuth({ pathname: "/mail" })).not.toThrow();
  });

  it("throws redirect when unauthenticated", () => {
    vi.mocked(wgwLiveApiEnabled).mockReturnValue(true);
    vi.mocked(wgwHasAuthenticatedSession).mockReturnValue(false);
    try {
      requireWgwAuth({ pathname: "/drive", searchStr: "?view=recent" });
      expect.unreachable("expected redirect throw");
    } catch (error) {
      expect(error).toMatchObject({
        options: {
          to: "/login",
          search: { return: "/drive?view=recent" },
        },
      });
    }
  });
});
