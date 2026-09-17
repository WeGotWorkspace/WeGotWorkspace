/** @vitest-environment jsdom */
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchHomeState = vi.fn();

vi.mock("@/lib/api/wgw/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/wgw/http")>();
  return {
    ...actual,
    wgwLiveApiEnabled: vi.fn(() => true),
  };
});

vi.mock("@/wegotworkspace/src/wegotworkspace-home-state", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/wegotworkspace/src/wegotworkspace-home-state")>();
  return {
    ...actual,
    fetchWeGotWorkspaceHomeState: (...args: unknown[]) => fetchHomeState(...args),
  };
});

import { wgwLiveApiEnabled } from "@/lib/api/wgw/http";
import { useShowAdminApp } from "@/app-switch-button/src/use-show-admin-app";

describe("useShowAdminApp", () => {
  beforeEach(() => {
    cleanup();
    fetchHomeState.mockReset();
    vi.mocked(wgwLiveApiEnabled).mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
  });

  it("stays false for non-admins after home state resolves", async () => {
    fetchHomeState.mockResolvedValue({
      showAdmin: false,
      showCalendar: true,
      showContacts: true,
      showTasks: true,
      userDisplayName: "User",
      showUserMenu: true,
      pluginAppTiles: [],
    });

    const { result } = renderHook(() => useShowAdminApp());
    expect(result.current).toBe(false);
    await waitFor(() => {
      expect(fetchHomeState).toHaveBeenCalled();
    });
    expect(result.current).toBe(false);
  });

  it("becomes true when home state reports admin membership", async () => {
    fetchHomeState.mockResolvedValue({
      showAdmin: true,
      showCalendar: true,
      showContacts: true,
      showTasks: true,
      userDisplayName: "Admin",
      showUserMenu: true,
      pluginAppTiles: [],
    });

    const { result } = renderHook(() => useShowAdminApp());
    expect(result.current).toBe(false);
    await waitFor(() => {
      expect(result.current).toBe(true);
    });
  });
});
