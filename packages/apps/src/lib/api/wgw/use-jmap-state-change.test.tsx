import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { StateChangeListener } from "@/lib/jmap-client/push/state-change-subscription";
import {
  useJmapPushConnected,
  useJmapStateChange,
  type JmapPushHubLike,
} from "./use-jmap-state-change";

vi.mock("./jmap-push", () => ({ defaultJmapPushHub: () => null }));

function fakeHub() {
  const subscriptions: Array<{ types: readonly string[]; listener: StateChangeListener }> = [];
  const statusListeners = new Set<(connected: boolean) => void>();
  const hub: JmapPushHubLike & { connectedNow: boolean } = {
    connectedNow: false,
    get connected() {
      return this.connectedNow;
    },
    subscribe: vi.fn((types: readonly string[], listener: StateChangeListener) => {
      const entry = { types, listener };
      subscriptions.push(entry);
      return () => {
        subscriptions.splice(subscriptions.indexOf(entry), 1);
      };
    }),
    subscribeStatus: (listener) => {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
  };
  const setConnected = (connected: boolean) => {
    hub.connectedNow = connected;
    for (const listener of statusListeners) listener(connected);
  };
  return { hub, subscriptions, setConnected };
}

describe("useJmapStateChange", () => {
  it("subscribes once for the types and unsubscribes on unmount", () => {
    const { hub, subscriptions } = fakeHub();
    const { unmount, rerender } = renderHook(
      ({ types }) => useJmapStateChange(types, vi.fn(), hub),
      { initialProps: { types: ["Notebook", "Note"] } },
    );
    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0]!.types).toEqual(["Note", "Notebook"]);

    // A new array with the same types does not resubscribe.
    rerender({ types: ["Note", "Notebook"] });
    expect(hub.subscribe).toHaveBeenCalledTimes(1);

    unmount();
    expect(subscriptions).toHaveLength(0);
  });

  it("always calls the latest onChange without resubscribing", async () => {
    const { hub, subscriptions } = fakeHub();
    const first = vi.fn(async () => true);
    const second = vi.fn(async () => false);
    const { rerender } = renderHook(({ onChange }) => useJmapStateChange(["Note"], onChange, hub), {
      initialProps: { onChange: first },
    });
    rerender({ onChange: second });
    await expect(subscriptions[0]!.listener({ Note: "n2" }, "alice")).resolves.toBe(false);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith({ Note: "n2" }, "alice");
    expect(hub.subscribe).toHaveBeenCalledTimes(1);
  });

  it("does nothing without a hub (mock data, Storybook)", () => {
    const { result } = renderHook(() => useJmapStateChange(["Note"], vi.fn()));
    expect(result.current).toBeUndefined();
  });
});

describe("useJmapPushConnected", () => {
  it("follows the hub's push status", () => {
    const { hub, setConnected } = fakeHub();
    const { result } = renderHook(() => useJmapPushConnected(hub));
    expect(result.current).toBe(false);
    act(() => setConnected(true));
    expect(result.current).toBe(true);
    act(() => setConnected(false));
    expect(result.current).toBe(false);
  });

  it("is false without a hub", () => {
    const { result } = renderHook(() => useJmapPushConnected());
    expect(result.current).toBe(false);
  });
});
