import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.fn(async (_opts?: unknown) => undefined);
const flush = vi.fn();
let mockPathname = "/admin/plugins";

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useLocation: () => ({ pathname: mockPathname }),
    useRouter: () => ({
      state: { location: { pathname: mockPathname } },
      navigate,
      history: { flush },
    }),
  };
});

import { useAdminRouteSync } from "@/admin-core/src/use-admin-route-sync";

describe("useAdminRouteSync", () => {
  beforeEach(() => {
    navigate.mockClear();
    flush.mockClear();
    mockPathname = "/admin/plugins";
  });

  it("keeps a named admin section from the URL", () => {
    const { result } = renderHook(() => useAdminRouteSync());
    expect(result.current.section).toBe("plugins");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("treats /admin as the users pane", () => {
    mockPathname = "/admin";
    const { result } = renderHook(() => useAdminRouteSync());
    expect(result.current.section).toBe("users");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("canonicalizes unknown sections to /admin", () => {
    mockPathname = "/admin/not-a-pane";
    const { result } = renderHook(() => useAdminRouteSync());
    expect(result.current.section).toBe("users");
    expect(navigate).toHaveBeenCalledWith({ to: "/admin", replace: true });
  });

  it("canonicalizes /admin/users to /admin", () => {
    mockPathname = "/admin/users";
    const { result } = renderHook(() => useAdminRouteSync());
    expect(result.current.section).toBe("users");
    expect(navigate).toHaveBeenCalledWith({ to: "/admin", replace: true });
  });

  it("pushes a history entry when the user picks a section", () => {
    mockPathname = "/admin";
    const { result } = renderHook(() => useAdminRouteSync());

    act(() => {
      result.current.onSectionChange("mail");
    });

    expect(navigate).toHaveBeenCalledWith({
      to: "/admin/$section",
      params: { section: "mail" },
    });
  });
});
