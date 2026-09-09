import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.fn(async (_opts?: unknown) => undefined);
let mockPathname = "/settings/assistants";
let livePathname = "/settings/assistants";

function applyNavigateTarget(opts: unknown) {
  navigate(opts);
  const target = opts as { to?: string; params?: Record<string, string> };
  if (target.to === "/settings") {
    livePathname = "/settings";
  } else if (target.to === "/settings/$section" && target.params?.section) {
    livePathname = `/settings/${target.params.section}`;
  }
  return Promise.resolve();
}

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useLocation: () => ({ pathname: mockPathname }),
    useRouter: () => ({
      state: { location: { pathname: livePathname } },
      history: { flush: vi.fn() },
      navigate: applyNavigateTarget,
    }),
  };
});

import { useSettingsRouteSync } from "@/settings-core/src/use-settings-route-sync";

describe("useSettingsRouteSync", () => {
  beforeEach(() => {
    navigate.mockClear();
    mockPathname = "/settings/assistants";
    livePathname = "/settings/assistants";
  });

  it("keeps the assistants section when MCP is enabled", () => {
    const { result } = renderHook(() => useSettingsRouteSync(true));
    expect(result.current.section).toBe("assistants");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("redirects /settings/assistants to Settings home when MCP is disabled", () => {
    const { result } = renderHook(() => useSettingsRouteSync(false));
    expect(result.current.section).toBe("profile");
    expect(navigate).toHaveBeenCalledWith({ to: "/settings", params: {}, replace: true });
  });

  it("does not redirect until bootstrap reports the kill-switch", () => {
    const { result } = renderHook(() => useSettingsRouteSync(null));
    expect(result.current.section).toBe("assistants");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("navigates when the user picks a reachable section", () => {
    mockPathname = "/settings";
    livePathname = "/settings";
    const { result } = renderHook(() => useSettingsRouteSync(true));

    act(() => {
      result.current.onSectionChange("mail");
    });

    expect(navigate).toHaveBeenCalledWith({
      to: "/settings/$section",
      params: { section: "mail" },
      replace: false,
    });
  });

  it("does not rewrite the URL when leaving Settings for another app", () => {
    const { result, rerender } = renderHook(() => useSettingsRouteSync(true));
    navigate.mockClear();

    mockPathname = "/mail";
    livePathname = "/mail";
    rerender();

    expect(navigate).not.toHaveBeenCalled();

    act(() => {
      result.current.onSectionChange("offline");
    });

    expect(navigate).not.toHaveBeenCalled();
  });
});
