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
  reportReachability,
  resetConnectivityHubForTests,
  setPushHealthy,
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
});

describe("push as the online check (#2296)", () => {
  afterEach(() => {
    setPushHealthy(false);
    resetConnectivityHubForTests();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("a push response counts as a probe success", async () => {
    vi.useFakeTimers();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const unsubscribe = subscribeBrowserOnline(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(getConnectivitySnapshot()).toBe(false);

    reportReachability(true);
    expect(getConnectivitySnapshot()).toBe(true);
    unsubscribe();
  });

  it("a failed push feeds the probe backoff", async () => {
    vi.useFakeTimers();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const unsubscribe = subscribeBrowserOnline(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    reportReachability(false);
    expect(getConnectivitySnapshot()).toBe(false);
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("one failed push while push is healthy leaves the tab online and starts no probe", async () => {
    vi.useFakeTimers();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const unsubscribe = subscribeBrowserOnline(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    setPushHealthy(true);
    fetchMock.mockClear();

    reportReachability(false);
    expect(getConnectivitySnapshot()).toBe(true);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchMock).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("push going unhealthy after failures goes offline and probes on the backoff", async () => {
    vi.useFakeTimers();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const unsubscribe = subscribeBrowserOnline(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    setPushHealthy(true);
    fetchMock.mockClear();

    reportReachability(false);
    reportReachability(false);
    expect(getConnectivitySnapshot()).toBe(true);
    setPushHealthy(false);
    expect(getConnectivitySnapshot()).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3100);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("a follower tab goes offline on the offline notice, not on plain failures", async () => {
    vi.useFakeTimers();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const other = new BroadcastChannel("wgw-reachability");
    const received: unknown[] = [];
    other.onmessage = (event: MessageEvent) => received.push(event.data);
    const unsubscribe = subscribeBrowserOnline(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    setPushHealthy(true);
    fetchMock.mockClear();

    other.postMessage({ type: "wgw-reachability", reachable: false });
    other.postMessage({ type: "wgw-reachability", reachable: false });
    await vi.advanceTimersByTimeAsync(10);
    expect(getConnectivitySnapshot()).toBe(true);

    setPushHealthy(false);
    await vi.advanceTimersByTimeAsync(10);
    expect(getConnectivitySnapshot()).toBe(true);
    expect(received.some((m) => (m as { offline?: boolean }).offline)).toBe(false);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchMock).not.toHaveBeenCalled();

    other.postMessage({
      type: "wgw-reachability",
      reachable: false,
      offline: true,
      failures: 2,
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(getConnectivitySnapshot()).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3100);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    other.close();
    unsubscribe();
  });

  it("posts an offline notice when push turns unhealthy after failures", async () => {
    vi.useFakeTimers();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    const other = new BroadcastChannel("wgw-reachability");
    const received: unknown[] = [];
    other.onmessage = (event: MessageEvent) => received.push(event.data);
    const unsubscribe = subscribeBrowserOnline(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    setPushHealthy(true);

    reportReachability(false);
    reportReachability(false);
    setPushHealthy(false);
    await vi.advanceTimersByTimeAsync(10);
    expect(received).toContainEqual({
      type: "wgw-reachability",
      reachable: false,
      offline: true,
      failures: 2,
    });
    other.close();
    unsubscribe();
  });

  it("a push response cancels a probe in flight", async () => {
    vi.useFakeTimers();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    let rejectProbe: (error: unknown) => void = () => undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise((_resolve, reject) => (rejectProbe = reject))),
    );
    const unsubscribe = subscribeBrowserOnline(() => undefined);
    await vi.advanceTimersByTimeAsync(0);

    reportReachability(true);
    rejectProbe(new TypeError("Failed to fetch"));
    await vi.advanceTimersByTimeAsync(0);
    expect(getConnectivitySnapshot()).toBe(true);
    unsubscribe();
  });

  it("sends no probe while push is healthy and resumes when it stops", async () => {
    vi.useFakeTimers();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);
    const unsubscribe = subscribeBrowserOnline(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    setPushHealthy(true);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getConnectivitySnapshot()).toBe(true);

    reportReachability(false);
    setPushHealthy(false);
    await vi.advanceTimersByTimeAsync(4100); // second failure in a row: 4 s wait
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
    unsubscribe();
  });
});
