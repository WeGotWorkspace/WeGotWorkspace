import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTasksAppBootstrap } from "@/lib/api/mock/tasks-bootstrap";
import { useTasksAPI } from "./use-tasks-api";
import type { TasksApiSource } from "./tasks-api-source";

const bootstrap = createTasksAppBootstrap();
const calls: string[] = [];
const patchBootstrap = vi.fn();
const flush = vi.fn(async () => {
  calls.push("flush");
});
const syncTasksInbound = vi.fn();
const readCache = vi.fn(async () => {
  calls.push("read-cache");
  return bootstrap;
});
let reconnect: (() => void) | undefined;
let online = true;

vi.mock("@/lib/live/use-hybrid-bootstrap", () => ({
  useHybridBootstrap: () => ({
    phase: "ready",
    error: null,
    data: bootstrap,
    load: vi.fn(),
    successVersion: 1,
    patchBootstrap,
  }),
}));

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({ show: vi.fn(), showError: vi.fn() }),
}));

vi.mock("@/hooks/use-connectivity", () => ({
  useConnectivity: () => ({ online }),
  useOnReconnect: (callback: () => void) => {
    reconnect = callback;
  },
}));

vi.mock("@/lib/api/wgw/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/wgw/http")>()),
  wgwLiveApiEnabled: () => true,
  wgwAwaitSessionRefreshForReconnect: async () => undefined,
}));

vi.mock("@/lib/offline/offline-session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/offline/offline-session")>()),
  readOfflineTasksUsername: () => "ada",
  resolveTasksOfflineUsername: () => "ada",
}));

vi.mock("@/lib/offline/tasks-hybrid-operations", () => ({
  createHybridTasksOperations: () => ({}),
  getTasksSyncRunner: () => ({ flush }),
}));

vi.mock("@/lib/offline/tasks-offline-store", () => ({
  readTasksBootstrapFromCache: () => readCache(),
}));

vi.mock("@/lib/offline/tasks-inbound-sync", () => ({
  TASKS_INBOUND_POLL_MS: 10_000,
  syncTasksInbound: (...args: unknown[]) => syncTasksInbound(...args),
}));

const source: TasksApiSource = {
  loadBootstrap: async () => bootstrap,
  createOperations: () => undefined,
};

describe("useTasksAPI inbound sync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    calls.length = 0;
    online = true;
    reconnect = undefined;
    patchBootstrap.mockReset();
    flush.mockClear();
    readCache.mockClear();
    syncTasksInbound.mockReset();
    syncTasksInbound.mockImplementation(async () => {
      calls.push("pull");
      return { changed: true, usedFullResync: false };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls the server while online and paints the cache when something changed", async () => {
    renderHook(() => useTasksAPI(source));
    expect(syncTasksInbound).not.toHaveBeenCalled();

    await act(() => vi.advanceTimersByTimeAsync(10_000));

    expect(syncTasksInbound).toHaveBeenCalledWith("ada");
    expect(calls).toEqual(["pull", "read-cache"]);
    expect(patchBootstrap).toHaveBeenCalledTimes(1);
  });

  it("does not repaint when the poll found nothing", async () => {
    syncTasksInbound.mockResolvedValue({ changed: false, usedFullResync: false });
    renderHook(() => useTasksAPI(source));

    await act(() => vi.advanceTimersByTimeAsync(10_000));

    expect(syncTasksInbound).toHaveBeenCalledTimes(1);
    expect(readCache).not.toHaveBeenCalled();
    expect(patchBootstrap).not.toHaveBeenCalled();
  });

  it("a failed poll leaves the list as it is", async () => {
    syncTasksInbound.mockRejectedValue(new TypeError("network down"));
    renderHook(() => useTasksAPI(source));

    await act(() => vi.advanceTimersByTimeAsync(10_000));

    expect(patchBootstrap).not.toHaveBeenCalled();
  });

  it("does not poll while offline", async () => {
    online = false;
    renderHook(() => useTasksAPI(source));

    await act(() => vi.advanceTimersByTimeAsync(30_000));

    expect(syncTasksInbound).not.toHaveBeenCalled();
  });

  it("after reconnect: flush, then pull, then re-read the cache", async () => {
    renderHook(() => useTasksAPI(source));
    expect(reconnect).toBeDefined();

    await act(async () => {
      reconnect!();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(calls).toEqual(["flush", "pull", "read-cache"]);
    expect(syncTasksInbound).toHaveBeenCalledWith("ada", { waitForLock: true });
    expect(patchBootstrap).toHaveBeenCalledTimes(1);
  });

  it("after reconnect a failed pull still shows the flushed cache", async () => {
    syncTasksInbound.mockImplementation(async () => {
      calls.push("pull");
      throw new TypeError("network down");
    });
    renderHook(() => useTasksAPI(source));

    await act(async () => {
      reconnect!();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(calls).toEqual(["flush", "pull", "read-cache"]);
    expect(patchBootstrap).toHaveBeenCalledTimes(1);
  });

  describe("other tabs of this browser (#1815)", () => {
    const heard: unknown[] = [];
    let otherTab: BroadcastChannel;
    const delivered = async () => {
      vi.useRealTimers();
      await act(() => new Promise((resolve) => setTimeout(resolve, 30)));
    };

    beforeEach(() => {
      heard.length = 0;
      otherTab = new BroadcastChannel("wgw.tasks.bootstrap");
      otherTab.onmessage = (event) => heard.push(event.data);
    });

    afterEach(() => {
      otherTab.close();
    });

    it("tells the other tabs when its poll changed the shared cache", async () => {
      renderHook(() => useTasksAPI(source));

      await act(() => vi.advanceTimersByTimeAsync(10_000));
      await delivered();

      expect(heard).toEqual([{ type: "tasks-bootstrap-updated", username: "ada" }]);
    });

    it("tells no one when the poll found nothing", async () => {
      syncTasksInbound.mockResolvedValue({ changed: false, usedFullResync: false });
      renderHook(() => useTasksAPI(source));

      await act(() => vi.advanceTimersByTimeAsync(10_000));
      await delivered();

      expect(heard).toEqual([]);
    });

    it("tells the other tabs after a reconnect flush", async () => {
      renderHook(() => useTasksAPI(source));

      await act(async () => {
        reconnect!();
        await vi.advanceTimersByTimeAsync(0);
      });
      await delivered();

      expect(heard).toEqual([{ type: "tasks-bootstrap-updated", username: "ada" }]);
    });

    it("repaints from the cache when another tab changed it, without a pull", async () => {
      vi.useRealTimers();
      renderHook(() => useTasksAPI(source));

      otherTab.postMessage({ type: "tasks-bootstrap-updated", username: "someone-else" });
      await delivered();
      expect(readCache).not.toHaveBeenCalled();

      otherTab.postMessage({ type: "tasks-bootstrap-updated", username: "ada" });
      await delivered();

      expect(syncTasksInbound).not.toHaveBeenCalled();
      expect(calls).toEqual(["read-cache"]);
      expect(patchBootstrap).toHaveBeenCalledTimes(1);
    });
  });
});
