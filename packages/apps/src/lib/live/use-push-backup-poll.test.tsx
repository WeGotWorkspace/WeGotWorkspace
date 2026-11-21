import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useIntervalPollTarget, usePushBackupPoll } from "@/lib/live/use-push-backup-poll";

function fakeHub(initial: boolean) {
  const listeners = new Set<(connected: boolean) => void>();
  return {
    connected: initial,
    subscribe: () => () => undefined,
    subscribeStatus(listener: (connected: boolean) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next: boolean) {
      this.connected = next;
      for (const listener of listeners) listener(next);
    },
  };
}

describe("usePushBackupPoll", () => {
  it("starts the poll only while push is not healthy", async () => {
    const hub = fakeHub(false);
    const target = { startPolling: vi.fn(), stopPolling: vi.fn() };
    const { act } = await import("@testing-library/react");
    renderHook(() => usePushBackupPoll(target, 10_000, hub));
    expect(target.startPolling).toHaveBeenCalledWith(10_000);

    act(() => hub.set(true));
    expect(target.stopPolling).toHaveBeenCalled();
    expect(target.startPolling).toHaveBeenCalledTimes(1);

    act(() => hub.set(false));
    expect(target.startPolling).toHaveBeenCalledTimes(2);
  });

  it("never starts while push is healthy from the beginning", () => {
    const target = { startPolling: vi.fn(), stopPolling: vi.fn() };
    renderHook(() => usePushBackupPoll(target, 10_000, fakeHub(true)));
    expect(target.startPolling).not.toHaveBeenCalled();
  });

  it("waits for a target", () => {
    expect(() => renderHook(() => usePushBackupPoll(null, 10_000, fakeHub(false)))).not.toThrow();
  });

  it("an interval target ticks on the interval and stops", () => {
    vi.useFakeTimers();
    const tick = vi.fn();
    const { result } = renderHook(() => useIntervalPollTarget(tick));
    result.current?.startPolling(1000);
    vi.advanceTimersByTime(3000);
    expect(tick).toHaveBeenCalledTimes(3);
    result.current?.stopPolling();
    vi.advanceTimersByTime(3000);
    expect(tick).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });
});
