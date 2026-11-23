import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOfflineReconnectFlush } from "@/hooks/use-offline-reconnect-flush";
import { setTrafficJitterSource } from "@/lib/traffic/jitter";
import { useConnectivity, useOnReconnect } from "@/hooks/use-connectivity";
import {
  getConnectivitySnapshot,
  offlineProbeWaitMs,
  probeBrowserReachable,
  readBrowserOnline,
  resetConnectivityHubForTests,
  subscribeBrowserOnline,
} from "@/lib/offline/core/browser-online";

describe("readBrowserOnline", () => {
  it("reflects navigator.onLine when available", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    expect(readBrowserOnline()).toBe(false);

    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    expect(readBrowserOnline()).toBe(true);
  });
});

describe("subscribeBrowserOnline", () => {
  afterEach(() => {
    resetConnectivityHubForTests();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("notifies with the current navigator.onLine value on subscribe", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const onStoreChange = vi.fn();

    const unsubscribe = subscribeBrowserOnline(onStoreChange);

    expect(onStoreChange).toHaveBeenCalled();
    expect(getConnectivitySnapshot()).toBe(false);
    unsubscribe();
  });

  it("fires store change on offline and online events", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    const onStoreChange = vi.fn();
    const unsubscribe = subscribeBrowserOnline(onStoreChange);

    await waitFor(() => {
      expect(getConnectivitySnapshot()).toBe(true);
    });

    window.dispatchEvent(new Event("offline"));
    expect(getConnectivitySnapshot()).toBe(false);

    window.dispatchEvent(new Event("online"));
    await waitFor(() => {
      expect(getConnectivitySnapshot()).toBe(true);
    });

    unsubscribe();
  });

  it("detects reconnect when reachability returns without an online event", async () => {
    vi.useFakeTimers();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const onStoreChange = vi.fn();
    const unsubscribe = subscribeBrowserOnline(onStoreChange);

    await vi.waitFor(() => {
      expect(getConnectivitySnapshot()).toBe(false);
    });

    await vi.advanceTimersByTimeAsync(2000);

    await vi.waitFor(() => {
      expect(getConnectivitySnapshot()).toBe(true);
    });

    unsubscribe();
    vi.useRealTimers();
  });
});

describe("probeBrowserReachable", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns false without fetching when navigator.onLine is false", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(probeBrowserReachable()).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns false when a same-origin HEAD request fails with a network error", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(probeBrowserReachable()).resolves.toBe(false);
  });
});

describe("useConnectivity", () => {
  let unmountHook: (() => void) | undefined;

  beforeEach(() => {
    resetConnectivityHubForTests();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
  });

  afterEach(() => {
    unmountHook?.();
    unmountHook = undefined;
    resetConnectivityHubForTests();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("initializes from navigator.onLine when already offline", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);

    const { result, unmount } = renderHook(() => useConnectivity());
    unmountHook = unmount;

    expect(result.current.online).toBe(false);
  });

  it("syncs navigator.onLine on mount when the page loads offline", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);

    const { result, unmount } = renderHook(() => useConnectivity());
    unmountHook = unmount;

    expect(result.current.online).toBe(false);
  });

  it("detects offline via reachability probe when navigator.onLine is stale", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    const { result, unmount } = renderHook(() => useConnectivity());
    unmountHook = unmount;

    expect(result.current.online).toBe(true);

    await waitFor(() => {
      expect(result.current.online).toBe(false);
    });
  });

  it("updates when the browser fires offline and online events", async () => {
    const { result, unmount } = renderHook(() => useConnectivity());
    unmountHook = unmount;
    await waitFor(() => {
      expect(result.current.online).toBe(true);
    });

    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(result.current.online).toBe(false);

    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(() => {
      expect(result.current.online).toBe(true);
    });
  });
});

describe("useOnReconnect", () => {
  afterEach(() => {
    resetConnectivityHubForTests();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("runs the callback when reachability returns without an online event", async () => {
    vi.useFakeTimers();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const onReconnect = vi.fn();
    renderHook(() => useOnReconnect(onReconnect));

    await vi.waitFor(() => {
      expect(getConnectivitySnapshot()).toBe(false);
    });

    await vi.advanceTimersByTimeAsync(2000);

    await vi.waitFor(() => {
      expect(getConnectivitySnapshot()).toBe(true);
      expect(onReconnect).toHaveBeenCalledTimes(1);
    });
  });
});

describe("calm recovery (#2288)", () => {
  afterEach(() => {
    resetConnectivityHubForTests();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    setTrafficJitterSource(() => 0);
  });

  it("waits 2 s, 4 s, 8 s … up to 60 s after each failed probe", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map(offlineProbeWaitMs)).toEqual([
      2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000,
    ]);
  });

  it("a server that keeps refusing gets at most 5 probes in 20 s", async () => {
    vi.useFakeTimers();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);

    const unsubscribe = subscribeBrowserOnline(() => undefined);
    await vi.advanceTimersByTimeAsync(20_000);

    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(5);
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3);
    unsubscribe();
  });

  it("jitter only shortens the wait", async () => {
    vi.useFakeTimers();
    setTrafficJitterSource(() => 0.999);
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);

    const unsubscribe = subscribeBrowserOnline(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("a probe failure from another tab counts as an attempt and re-arms the wait", async () => {
    vi.useFakeTimers();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);
    const other = new BroadcastChannel("wgw-reachability");

    const unsubscribe = subscribeBrowserOnline(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1500);
    other.postMessage({ type: "wgw-reachability", reachable: false });
    await vi.advanceTimersByTimeAsync(10);
    // The wait is now 4 s (second failure), counted from the message.
    await vi.advanceTimersByTimeAsync(3500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(600);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    other.close();
    unsubscribe();
  });

  it("a probe success from another tab brings this tab online", async () => {
    vi.useFakeTimers();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const other = new BroadcastChannel("wgw-reachability");

    const unsubscribe = subscribeBrowserOnline(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(getConnectivitySnapshot()).toBe(false);

    other.postMessage({ type: "wgw-reachability", reachable: true });
    await vi.advanceTimersByTimeAsync(10);
    expect(getConnectivitySnapshot()).toBe(true);
    other.close();
    unsubscribe();
  });

  it("spreads the reconnect flush over 0–4 s", async () => {
    vi.useFakeTimers();
    setTrafficJitterSource(() => 0.5);
    const flush = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockResolvedValue(new Response(null, { status: 200 })),
    );
    resetConnectivityHubForTests();
    const { result, unmount } = renderHook(() =>
      useOfflineReconnectFlush({ enabled: true, flush }),
    );
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000); // probe wait (jitter 0.5 → 0.75 × 2000 = 1500)
    await vi.advanceTimersByTimeAsync(600);
    expect(flush).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2100);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(false);
    unmount();
  });

  it("skips the reconnect flush when offline again during the wait", async () => {
    vi.useFakeTimers();
    setTrafficJitterSource(() => 0.5);
    const flush = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);
    resetConnectivityHubForTests();
    const { unmount } = renderHook(() => useOfflineReconnectFlush({ enabled: true, flush }));
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1600); // probe succeeds, flush wait (≤ 4 s) starts
    // Go offline again inside the wait.
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    await vi.advanceTimersByTimeAsync(4500);
    expect(flush).not.toHaveBeenCalled();
    // Back online: the flush runs once.
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    await vi.advanceTimersByTimeAsync(4500);
    expect(flush).toHaveBeenCalledTimes(1);
    unmount();
  });
});
