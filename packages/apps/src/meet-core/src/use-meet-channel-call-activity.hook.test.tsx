/** @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JmapPushHubLike } from "@/lib/api/wgw/use-jmap-state-change";
import type { StateChangeListener } from "@/lib/jmap-client/push/state-change-subscription";
import { useMeetChannelCallActivity } from "@/meet-core/src/use-meet-channel-call-activity";
import type { MeetAPIOperations, MeetChannel } from "@/lib/models/meet-types";

const general: MeetChannel = {
  id: "chat-01ARZ3NDEKTSV4RRFFQ69G5FAV",
  name: "general",
  kind: "channel",
  scope: "personal",
};

const other: MeetChannel = {
  id: "chat-01ARZ3NDEKTSV4RRFFQ69G5FAW",
  name: "design",
  kind: "channel",
  scope: "personal",
};

describe("useMeetChannelCallActivity", () => {
  it("does not poll again when chat hands a new channel list with the same rooms", async () => {
    const roomStatus = vi.fn(async () => ({ reserved: false, active: false }));
    const operations = { roomStatus } as unknown as MeetAPIOperations;
    const { rerender } = renderHook(
      ({ channels }) =>
        useMeetChannelCallActivity({
          operations,
          channels,
          selectedChannelId: general.id,
          joinedRoomCode: null,
          pollMs: 60_000,
        }),
      { initialProps: { channels: [general] as readonly MeetChannel[] } },
    );
    await waitFor(() => expect(roomStatus).toHaveBeenCalledTimes(1));
    for (let index = 0; index < 5; index += 1) {
      // An unread-count patch: same rooms, new array and new objects.
      rerender({ channels: [{ ...general, name: `general ${index}` }] });
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(roomStatus).toHaveBeenCalledTimes(1);
  });
});

function fakePushHub(connected: boolean) {
  const listeners: Array<{ types: readonly string[]; listener: StateChangeListener }> = [];
  const hub: JmapPushHubLike = {
    connected,
    subscribe: (types, listener) => {
      const entry = { types, listener };
      listeners.push(entry);
      return () => {
        listeners.splice(listeners.indexOf(entry), 1);
      };
    },
    subscribeStatus: () => () => undefined,
  };
  return {
    hub,
    ring: async (type: string, state: string) => {
      return Promise.all(
        listeners
          .filter((entry) => entry.types.includes(type))
          .map((entry) => entry.listener({ [type]: state }, "bob")),
      );
    },
  };
}

describe("useMeetChannelCallActivity with the push doorbell (#2295)", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  function setup(connected: boolean, selectedChannelId: string | null = general.id) {
    vi.useFakeTimers();
    const roomStatus = vi.fn(async () => ({ reserved: false, active: true }));
    const operations = { roomStatus } as unknown as MeetAPIOperations;
    const push = fakePushHub(connected);
    const view = renderHook(
      ({ selected }) =>
        useMeetChannelCallActivity({
          operations,
          channels: [general, other],
          selectedChannelId: selected,
          joinedRoomCode: null,
          pollMs: 5_000,
          pushHub: push.hub,
        }),
      { initialProps: { selected: selectedChannelId } },
    );
    return { roomStatus, push, view };
  }

  it("makes no interval request while push is connected", async () => {
    const { roomStatus, view } = setup(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(roomStatus).toHaveBeenCalledTimes(1);
    expect(view.result.current).toEqual({ [general.id]: true });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(roomStatus).toHaveBeenCalledTimes(1);
  });

  it("reads the room once per MeetCall state change", async () => {
    const { roomStatus, push } = setup(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(roomStatus).toHaveBeenCalledTimes(1);

    await act(async () => {
      await push.ring("MeetCall", "2.abc");
    });
    expect(roomStatus).toHaveBeenCalledTimes(2);
  });

  it("reads again when the selection changes, and only once", async () => {
    const { roomStatus, view } = setup(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    view.rerender({ selected: other.id });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(roomStatus).toHaveBeenCalledTimes(2);
    expect(roomStatus).toHaveBeenLastCalledWith({ room: other.id.toLowerCase() });
  });

  it("keeps the interval only while push is down", async () => {
    const { roomStatus } = setup(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(roomStatus).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(roomStatus).toHaveBeenCalledTimes(3);
  });

  it("makes up a ring that arrived while the tab was hidden once it shows again", async () => {
    const { roomStatus, push } = setup(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    await act(async () => {
      await push.ring("MeetCall", "2.abc");
    });
    expect(roomStatus).toHaveBeenCalledTimes(1);

    hidden.mockReturnValue(false);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(roomStatus).toHaveBeenCalledTimes(2);
    hidden.mockRestore();
  });

  it("keeps the previous flags and resolves false when a read fails", async () => {
    const { roomStatus, push, view } = setup(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(view.result.current).toEqual({ [general.id]: true });

    roomStatus.mockRejectedValueOnce(new Error("offline"));
    let results: unknown[] = [];
    await act(async () => {
      results = await push.ring("MeetCall", "0");
    });
    expect(results).toEqual([false]);
    expect(view.result.current).toEqual({ [general.id]: true });
  });

  it("lets an older, slower read not overwrite a newer one", async () => {
    const { roomStatus, push, view } = setup(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    let resolveOld: (value: { reserved: boolean; active: boolean }) => void = () => undefined;
    roomStatus.mockImplementationOnce(() => new Promise((resolve) => void (resolveOld = resolve)));
    let oldRing: Promise<unknown[]> = Promise.resolve([]);
    await act(async () => {
      oldRing = push.ring("MeetCall", "2.abc");
      await vi.advanceTimersByTimeAsync(0);
    });
    roomStatus.mockResolvedValueOnce({ reserved: false, active: false });
    await act(async () => {
      await push.ring("MeetCall", "0");
    });
    expect(view.result.current).toEqual({});

    await act(async () => {
      resolveOld({ reserved: false, active: true });
      await oldRing;
    });
    expect(view.result.current).toEqual({});
  });
});
