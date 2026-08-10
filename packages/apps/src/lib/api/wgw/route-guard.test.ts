import { describe, expect, it, vi } from "vitest";
import {
  buildWgwLoginHref,
  isWgwAuthRoutePathname,
  isWgwPublicRoutePathname,
  requireWgwAuth,
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
