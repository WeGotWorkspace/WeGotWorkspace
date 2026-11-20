import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useMeetChannelCallActivity } from "@/meet-core/src/use-meet-channel-call-activity";
import type { MeetAPIOperations, MeetChannel } from "@/lib/models/meet-types";

const general: MeetChannel = {
  id: "chat-01ARZ3NDEKTSV4RRFFQ69G5FAV",
  name: "general",
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
