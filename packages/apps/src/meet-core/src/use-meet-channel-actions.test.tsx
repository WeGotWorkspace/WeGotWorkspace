import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MeetChannel } from "@/lib/models/meet-types";
import { useMeetChannelActions } from "@/meet-core/src/use-meet-channel-actions";
import type { MeetChannelDialogs } from "@/meet-core/src/use-meet-channel-dialogs";

function setup(operations: unknown, channels: MeetChannel[]) {
  const onError = vi.fn();
  const dialogs = {
    dialog: null,
    setDialog: vi.fn(),
    setEditMeeting: vi.fn(),
    setPendingUpcomingDelete: vi.fn(),
  } as unknown as MeetChannelDialogs;
  const { result } = renderHook(() =>
    useMeetChannelActions({
      channels,
      setChannels: vi.fn(),
      selectedId: null,
      setSelectedId: vi.fn(),
      operations: operations as never,
      upcomingMeetings: [],
      dialogs,
      onError,
    }),
  );
  return { actions: result.current, onError };
}

describe("useMeetChannelActions.patchShareWith", () => {
  it("reports and rethrows when the save fails", async () => {
    const failure = new Error("nope");
    const { actions, onError } = setup(
      { patchChannelShareWith: vi.fn().mockRejectedValue(failure) },
      [{ id: "c1", shareWith: {} } as unknown as MeetChannel],
    );
    await expect(actions.patchShareWith("c1", {})).rejects.toBe(failure);
    expect(onError).toHaveBeenCalledWith(failure);
  });

  it("reports and rejects when the channel is gone", async () => {
    const { actions, onError } = setup(undefined, []);
    await expect(actions.patchShareWith("missing", {})).rejects.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
