import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  syncTasksIfStale,
  TASKS_INBOUND_PUSH_POLL_MS,
  TASKS_SHARED_PULL_WAIT_MS,
  useTasksLiveInbound,
} from "@/lib/offline/tasks/use-tasks-live-inbound";

const mocks = vi.hoisted(() => ({
  syncTasksInbound: vi.fn(),
  readTasksChangesState: vi.fn(),
  notify: vi.fn(),
  pushConnected: false,
  subscribedTypes: [] as string[],
  listener: null as ((states: Record<string, string>) => unknown) | null,
  owns: true,
  seatUsername: undefined as string | null | undefined,
  takeOver: null as (() => void) | null,
}));

vi.mock("@/lib/offline/tasks/tasks-inbound-sync", () => ({
  syncTasksInbound: mocks.syncTasksInbound,
  TASKS_INBOUND_POLL_MS: 10_000,
}));
vi.mock("@/lib/offline/tasks/tasks-offline-store", () => ({
  readTasksChangesState: mocks.readTasksChangesState,
}));
vi.mock("@/lib/offline/tasks/tasks-bootstrap-sync", () => ({
  notifyTasksBootstrapUpdated: mocks.notify,
}));
vi.mock("@/lib/api/wgw/use-shared-inbound-sync", () => ({
  useInboundSyncSeat: (_app: string, username: string | null, onTakeOver: () => void) => {
    mocks.seatUsername = username;
    mocks.takeOver = onTakeOver;
    return () => mocks.owns;
  },
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
  mocks.owns = true;
  mocks.seatUsername = undefined;
  mocks.takeOver = null;
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

describe("syncTasksIfStale in a tab that does not sync", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("confirms the push once the syncing tab stored the state, without a pull", async () => {
    const result = syncTasksIfStale("admin", { Task: "s2" }, vi.fn(), () => false);
    await vi.advanceTimersByTimeAsync(600);
    mocks.readTasksChangesState.mockResolvedValue("s2");
    await vi.advanceTimersByTimeAsync(600);
    await expect(result).resolves.toBe(true);
    expect(mocks.syncTasksInbound).not.toHaveBeenCalled();
  });

  it("pulls itself when the syncing tab does not store the state in time", async () => {
    const onChanged = vi.fn(async () => undefined);
    const result = syncTasksIfStale("admin", { Task: "s2" }, onChanged, () => false);
    await vi.advanceTimersByTimeAsync(TASKS_SHARED_PULL_WAIT_MS - 600);
    expect(mocks.syncTasksInbound).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(700);
    await expect(result).resolves.toBe(true);
    expect(mocks.syncTasksInbound).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("pulls at once when it becomes the syncing tab while it waits", async () => {
    let owns = false;
    const result = syncTasksIfStale("admin", { Task: "s2" }, vi.fn(), () => owns);
    await vi.advanceTimersByTimeAsync(600);
    expect(mocks.syncTasksInbound).not.toHaveBeenCalled();
    owns = true;
    await vi.advanceTimersByTimeAsync(600);
    await expect(result).resolves.toBe(true);
    expect(mocks.syncTasksInbound).toHaveBeenCalledTimes(1);
  });
});

describe("useTasksLiveInbound", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("takes a seat among the tabs only while enabled", () => {
    const patchFromCache = vi.fn(async () => undefined);
    const { rerender } = renderHook(
      ({ enabled }) => useTasksLiveInbound({ username: "admin", enabled, patchFromCache }),
      { initialProps: { enabled: false } },
    );
    expect(mocks.seatUsername).toBeNull();
    rerender({ enabled: true });
    expect(mocks.seatUsername).toBe("admin");
  });

  it("does not poll while another tab syncs, and polls again once it owns the sync", async () => {
    vi.useFakeTimers();
    mocks.owns = false;
    renderHook(() =>
      useTasksLiveInbound({ username: "admin", enabled: true, patchFromCache: vi.fn() }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(mocks.syncTasksInbound).not.toHaveBeenCalled();

    mocks.owns = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(mocks.syncTasksInbound).toHaveBeenCalledTimes(1);
  });

  it("pulls once and repaints when it takes over from another tab", async () => {
    const patchFromCache = vi.fn(async () => undefined);
    renderHook(() => useTasksLiveInbound({ username: "admin", enabled: true, patchFromCache }));
    await act(async () => {
      mocks.takeOver?.();
    });
    expect(mocks.syncTasksInbound).toHaveBeenCalledTimes(1);
    expect(patchFromCache).toHaveBeenCalledTimes(1);
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
