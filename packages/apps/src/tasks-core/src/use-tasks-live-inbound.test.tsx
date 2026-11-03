import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  syncTasksIfStale,
  TASKS_INBOUND_PUSH_POLL_MS,
  useTasksLiveInbound,
} from "./use-tasks-live-inbound";

const mocks = vi.hoisted(() => ({
  syncTasksInbound: vi.fn(),
  readTasksChangesState: vi.fn(),
  notify: vi.fn(),
  pushConnected: false,
  subscribedTypes: [] as string[],
  listener: null as ((states: Record<string, string>) => unknown) | null,
}));

vi.mock("@/lib/offline/tasks-inbound-sync", () => ({
  syncTasksInbound: mocks.syncTasksInbound,
  TASKS_INBOUND_POLL_MS: 10_000,
}));
vi.mock("@/lib/offline/tasks-offline-store", () => ({
  readTasksChangesState: mocks.readTasksChangesState,
}));
vi.mock("@/lib/offline/tasks-bootstrap-sync", () => ({
  notifyTasksBootstrapUpdated: mocks.notify,
}));
vi.mock("@/lib/api/wgw/use-jmap-state-change", () => ({
  useJmapPushConnected: () => mocks.pushConnected,
  useJmapStateChange: (
    types: readonly string[],
    listener: (states: Record<string, string>) => unknown,
  ) => {
    mocks.subscribedTypes = [...types];
    mocks.listener = listener;
  },
}));

beforeEach(() => {
  mocks.syncTasksInbound.mockReset().mockResolvedValue({ changed: true, usedFullResync: false });
  mocks.readTasksChangesState.mockReset().mockResolvedValue("s1");
  mocks.notify.mockReset();
  mocks.pushConnected = false;
  mocks.subscribedTypes = [];
  mocks.listener = null;
});

describe("syncTasksIfStale", () => {
  it("does not pull when the pushed state equals the stored one", async () => {
    const onChanged = vi.fn(async () => undefined);
    await expect(
      syncTasksIfStale("admin", { Task: "s1", TaskList: "s1" }, onChanged),
    ).resolves.toBe(true);
    expect(mocks.syncTasksInbound).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("pulls once and repaints every tab when the pushed state differs", async () => {
    const onChanged = vi.fn(async () => undefined);
    await expect(
      syncTasksIfStale("admin", { Task: "s2", TaskList: "s2" }, onChanged),
    ).resolves.toBe(true);
    expect(mocks.syncTasksInbound).toHaveBeenCalledTimes(1);
    expect(mocks.notify).toHaveBeenCalledWith("admin");
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("confirms a pull that found nothing new without repainting", async () => {
    mocks.syncTasksInbound.mockResolvedValue({ changed: false, usedFullResync: false });
    const onChanged = vi.fn(async () => undefined);
    await expect(syncTasksIfStale("admin", { Task: "s2" }, onChanged)).resolves.toBe(true);
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("leaves the push unconfirmed when another tab holds the lock", async () => {
    mocks.syncTasksInbound.mockResolvedValue(undefined);
    await expect(syncTasksIfStale("admin", { Task: "s2" }, vi.fn())).resolves.toBe(false);
  });

  it("leaves the push unconfirmed when the pull fails", async () => {
    mocks.syncTasksInbound.mockRejectedValue(new Error("offline"));
    await expect(syncTasksIfStale("admin", { Task: "s2" }, vi.fn())).resolves.toBe(false);
  });

  it("ignores a push without a Tasks state", async () => {
    await expect(syncTasksIfStale("admin", { Note: "n" }, vi.fn())).resolves.toBe(true);
    expect(mocks.readTasksChangesState).not.toHaveBeenCalled();
  });
});

describe("useTasksLiveInbound", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("subscribes to Task and TaskList only while enabled", () => {
    const patchFromCache = vi.fn(async () => undefined);
    const { rerender } = renderHook(
      ({ enabled }) => useTasksLiveInbound({ username: "admin", enabled, patchFromCache }),
      { initialProps: { enabled: false } },
    );
    expect(mocks.subscribedTypes).toEqual([]);
    rerender({ enabled: true });
    expect(mocks.subscribedTypes).toEqual(["Task", "TaskList"]);
  });

  it("a push with a new state repaints through the latest patchFromCache", async () => {
    const patchFromCache = vi.fn(async () => undefined);
    renderHook(() => useTasksLiveInbound({ username: "admin", enabled: true, patchFromCache }));
    await expect(mocks.listener?.({ Task: "s2", TaskList: "s2" })).resolves.toBe(true);
    expect(patchFromCache).toHaveBeenCalledTimes(1);
  });

  it("polls every 10 s without push and every 60 s while push is connected", async () => {
    vi.useFakeTimers();
    const patchFromCache = vi.fn(async () => undefined);
    const { rerender } = renderHook(() =>
      useTasksLiveInbound({ username: "admin", enabled: true, patchFromCache }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(mocks.syncTasksInbound).toHaveBeenCalledTimes(1);

    mocks.pushConnected = true;
    rerender();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TASKS_INBOUND_PUSH_POLL_MS - 1);
    });
    expect(mocks.syncTasksInbound).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(mocks.syncTasksInbound).toHaveBeenCalledTimes(2);
  });
});
