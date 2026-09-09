import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.fn(async (_opts?: unknown) => undefined);
let mockPathname = "/settings/assistants";
let mockParams: Record<string, string> = { section: "assistants" };

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useLocation: () => ({ pathname: mockPathname }),
    useParams: () => ({ ...mockParams }),
    useNavigate: () => navigate,
  };
});

import { useSettingsRouteSync } from "@/settings-core/src/use-settings-route-sync";

describe("useSettingsRouteSync", () => {
  beforeEach(() => {
    navigate.mockClear();
    mockPathname = "/settings/assistants";
    mockParams = { section: "assistants" };
  });

  it("keeps the assistants section when MCP is enabled", () => {
    const { result } = renderHook(() => useSettingsRouteSync(true));
    expect(result.current.section).toBe("assistants");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("redirects /settings/assistants to Settings home when MCP is disabled", () => {
    const { result } = renderHook(() => useSettingsRouteSync(false));
    expect(result.current.section).toBe("profile");
    expect(navigate).toHaveBeenCalledWith({ to: "/settings", replace: true });
  });

  it("does not redirect until bootstrap reports the kill-switch", () => {
    const { result } = renderHook(() => useSettingsRouteSync(null));
    expect(result.current.section).toBe("assistants");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("navigates when the user picks a reachable section", () => {
    mockPathname = "/settings";
    mockParams = {};
    const { result } = renderHook(() => useSettingsRouteSync(true));

    act(() => {
      result.current.onSectionChange("mail");
    });

    expect(navigate).toHaveBeenCalledWith({ to: "/settings/mail", replace: true });
  });
});
