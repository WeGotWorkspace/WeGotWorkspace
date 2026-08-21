import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCalendarAppBootstrap } from "@/lib/api/mock/calendar-bootstrap";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import { useCalendarAPI } from "./use-calendar-api";
import type { CalendarApiSource } from "./calendar-api-source";

const bootstrap = createCalendarAppBootstrap();
bootstrap.session = {
  ...mockWorkspaceSession,
  user: { ...mockWorkspaceSession.user, username: "demo@example.com" },
};

const mockPatchBootstrap = vi.fn();
const mockLoadBootstrap = vi.fn();
const mockFlush = vi.fn();
const mockOnReconnect = vi.fn();
const mockReadBrowserOnline = vi.fn(() => true);

vi.mock("@/lib/live/use-hybrid-bootstrap", () => ({
  useHybridBootstrap: () => ({
    phase: "ready",
    error: null,
    data: bootstrap,
    load: vi.fn(),
    successVersion: 1,
    patchBootstrap: mockPatchBootstrap,
  }),
}));

vi.mock("@/lib/offline/calendars-hybrid-operations", () => ({
  createHybridCalendarOperations: vi.fn(),
  getCalendarsSyncRunner: () => ({ flush: mockFlush }),
}));

vi.mock("@/lib/offline/calendars-offline-store", () => ({
  readCalendarBootstrapFromCache: vi.fn(),
}));

vi.mock("@/lib/offline/core/browser-online", () => ({
  readBrowserOnline: () => mockReadBrowserOnline(),
  isFetchNetworkError: vi.fn(() => false),
  subscribeBrowserOnline: vi.fn(() => () => undefined),
}));

vi.mock("@/hooks/use-connectivity", () => ({
  useConnectivity: () => ({ online: mockReadBrowserOnline() }),
  useOnReconnect: (callback: () => void) => {
    mockOnReconnect.mockImplementation(callback);
  },
}));

vi.mock("@/lib/api/wgw/http", () => ({
  wgwAwaitSessionRefreshForReconnect: vi.fn(async () => undefined),
  wgwLiveApiEnabled: vi.fn(() => false),
}));

describe("useCalendarAPI applyBootstrapRefresh", () => {
  beforeEach(async () => {
    mockReadBrowserOnline.mockReturnValue(true);
    mockPatchBootstrap.mockReset();
    mockLoadBootstrap.mockReset();
    mockFlush.mockReset();
    mockOnReconnect.mockReset();
    mockFlush.mockResolvedValue({ conflicts: [], schedulingConflicts: [], bootstrap: null });
    mockLoadBootstrap.mockResolvedValue(bootstrap);
    const { readCalendarBootstrapFromCache } =
      await import("@/lib/offline/calendars-offline-store");
    vi.mocked(readCalendarBootstrapFromCache).mockResolvedValue(bootstrap);
  });

  it("skips outbox flush while offline and still reloads bootstrap from cache", async () => {
    mockReadBrowserOnline.mockReturnValue(false);
    const source: CalendarApiSource = {
      loadBootstrap: mockLoadBootstrap,
      createOperations: () => undefined,
    };

    const { result } = renderHook(() => useCalendarAPI(source));

    await act(async () => {
      await result.current.refreshBootstrap();
    });

    expect(mockFlush).not.toHaveBeenCalled();
    expect(mockLoadBootstrap).toHaveBeenCalledTimes(1);
    expect(mockPatchBootstrap).toHaveBeenCalledTimes(1);
    expect(mockPatchBootstrap.mock.calls[0]?.[0]()).toEqual(bootstrap);
  });

  it("flushes the outbox then reloads bootstrap while online", async () => {
    const source: CalendarApiSource = {
      loadBootstrap: mockLoadBootstrap,
      createOperations: () => undefined,
    };

    const { result } = renderHook(() => useCalendarAPI(source));

    await act(async () => {
      await result.current.refreshBootstrap();
    });

    expect(mockFlush).toHaveBeenCalledTimes(1);
    expect(mockLoadBootstrap).toHaveBeenCalledTimes(1);
    expect(mockPatchBootstrap).toHaveBeenCalledTimes(1);
  });

  it("flushes pending outbox rows on reconnect", async () => {
    const source: CalendarApiSource = {
      loadBootstrap: mockLoadBootstrap,
      createOperations: () => undefined,
    };

    renderHook(() => useCalendarAPI(source));

    await act(async () => {
      mockOnReconnect();
    });

    await waitFor(() => {
      expect(mockFlush).toHaveBeenCalledTimes(1);
      expect(mockLoadBootstrap).toHaveBeenCalledTimes(1);
    });
  });
});
