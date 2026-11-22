import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCalendarAppBootstrap } from "@/lib/api/mock/calendar-bootstrap";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import { useCalendarAPI } from "./use-calendar-api";
import type { CalendarApiSource } from "./calendar-api-source";
import type { CalendarAPIOperations } from "@/lib/models/calendar-types";

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
const mockPushConnected = vi.fn(() => false);

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

vi.mock("@/lib/offline/calendars/calendars-hybrid-operations", () => ({
  createHybridCalendarOperations: vi.fn(),
  getCalendarsSyncRunner: () => ({ flush: mockFlush }),
}));

vi.mock("@/lib/offline/calendars/calendars-offline-store", () => ({
  readCalendarBootstrapFromCache: vi.fn(),
}));

vi.mock("@/lib/offline/core/browser-online", () => ({
  readBrowserOnline: () => mockReadBrowserOnline(),
  getConnectivitySnapshot: () => mockReadBrowserOnline(),
  isFetchNetworkError: vi.fn(() => false),
  subscribeBrowserOnline: vi.fn(() => () => undefined),
}));

vi.mock("@/hooks/use-connectivity", () => ({
  useConnectivity: () => ({ online: mockReadBrowserOnline() }),
  useOnReconnect: (callback: () => void) => {
    mockOnReconnect.mockImplementation(callback);
  },
}));

vi.mock("@/lib/api/wgw/use-jmap-state-change", () => ({
  useJmapPushConnected: () => mockPushConnected(),
}));

vi.mock("@/lib/api/wgw/http", () => ({
  wgwAwaitSessionRefreshForReconnect: vi.fn(async () => undefined),
  wgwLiveApiEnabled: vi.fn(() => false),
}));

describe("useCalendarAPI applyBootstrapRefresh", () => {
  beforeEach(async () => {
    mockReadBrowserOnline.mockReturnValue(true);
    mockPushConnected.mockReturnValue(false);
    mockPatchBootstrap.mockReset();
    mockLoadBootstrap.mockReset();
    mockFlush.mockReset();
    mockOnReconnect.mockReset();
    mockFlush.mockResolvedValue({ conflicts: [], schedulingConflicts: [], bootstrap: null });
    mockLoadBootstrap.mockResolvedValue(bootstrap);
    const { readCalendarBootstrapFromCache } =
      await import("@/lib/offline/calendars/calendars-offline-store");
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

  it("does not start a hybrid bootstrap poll interval", async () => {
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    const source: CalendarApiSource = {
      loadBootstrap: mockLoadBootstrap,
      createOperations: () => undefined,
    };

    renderHook(() => useCalendarAPI(source));

    expect(
      setIntervalSpy.mock.calls.some((call) => typeof call[1] === "number" && call[1] >= 10_000),
    ).toBe(false);
    setIntervalSpy.mockRestore();
  });

  it("a tab that turns visible re-reads the cache while push is connected and live inbound runs (#2287)", async () => {
    mockPushConnected.mockReturnValue(true);
    const source: CalendarApiSource = {
      loadBootstrap: mockLoadBootstrap,
      createOperations: () => undefined,
    };
    renderHook(() => useCalendarAPI(source, { liveInbound: true }));

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => expect(mockPatchBootstrap).toHaveBeenCalledTimes(1));
    expect(mockLoadBootstrap).not.toHaveBeenCalled();
    expect(mockFlush).not.toHaveBeenCalled();
  });

  it("a tab without live inbound keeps the full bootstrap on visible while push is connected", async () => {
    mockPushConnected.mockReturnValue(true);
    const source: CalendarApiSource = {
      loadBootstrap: mockLoadBootstrap,
      createOperations: () => undefined,
    };
    renderHook(() => useCalendarAPI(source));

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => expect(mockLoadBootstrap).toHaveBeenCalledTimes(1));
  });

  it("refreshes stale subscriptions after the cache paint and reloads when one was refreshed", async () => {
    mockPushConnected.mockReturnValue(true);
    const refreshStaleCalendarSubscriptions = vi.fn(async () => true);
    const source: CalendarApiSource = {
      loadBootstrap: mockLoadBootstrap,
      createOperations: () =>
        ({ refreshStaleCalendarSubscriptions }) as unknown as CalendarAPIOperations,
    };
    renderHook(() => useCalendarAPI(source, { liveInbound: true }));

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => expect(mockLoadBootstrap).toHaveBeenCalledTimes(1));
    expect(refreshStaleCalendarSubscriptions).toHaveBeenCalledTimes(1);
    expect(mockPatchBootstrap).toHaveBeenCalledTimes(2);
  });

  it("does not reload when no subscription was stale", async () => {
    mockPushConnected.mockReturnValue(true);
    const refreshStaleCalendarSubscriptions = vi.fn(async () => false);
    const source: CalendarApiSource = {
      loadBootstrap: mockLoadBootstrap,
      createOperations: () =>
        ({ refreshStaleCalendarSubscriptions }) as unknown as CalendarAPIOperations,
    };
    renderHook(() => useCalendarAPI(source, { liveInbound: true }));

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => expect(refreshStaleCalendarSubscriptions).toHaveBeenCalledTimes(1));
    expect(mockLoadBootstrap).not.toHaveBeenCalled();
    expect(mockPatchBootstrap).toHaveBeenCalledTimes(1);
  });

  it("a tab that turns visible runs a full bootstrap while push is down", async () => {
    const source: CalendarApiSource = {
      loadBootstrap: mockLoadBootstrap,
      createOperations: () => undefined,
    };
    renderHook(() => useCalendarAPI(source));

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => expect(mockLoadBootstrap).toHaveBeenCalledTimes(1));
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

  it("keeps the calendar out of the loading state while a reconnect syncs (#1532)", async () => {
    let finishFlush!: () => void;
    mockFlush.mockReturnValueOnce(
      new Promise((resolve) => {
        finishFlush = () => resolve({ conflicts: [], schedulingConflicts: [], bootstrap: null });
      }),
    );
    const source: CalendarApiSource = {
      loadBootstrap: mockLoadBootstrap,
      createOperations: () => undefined,
    };

    const { result } = renderHook(() => useCalendarAPI(source));

    await act(async () => {
      mockOnReconnect();
    });
    await waitFor(() => expect(mockFlush).toHaveBeenCalledTimes(1));

    expect(result.current.listLoading).toBe(false);
    expect(result.current.data.events).toEqual(bootstrap.data.events);

    await act(async () => {
      finishFlush();
    });
    await waitFor(() => expect(mockLoadBootstrap).toHaveBeenCalledTimes(1));
    expect(result.current.listLoading).toBe(false);
  });
});
