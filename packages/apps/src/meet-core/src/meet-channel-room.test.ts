import { describe, expect, it } from "vitest";
import { meetChannelCallRoom } from "@/calendar-core/src/calendar-meet-link";
import {
  meetChannelIdForRoom,
  meetChannelRoomId,
  meetGuestChatChannelId,
} from "@/meet-core/src/meet-channel-room";

const chatChannel = { id: "chat-01ARZ3NDEKTSV4RRFFQ69G5FAV", kind: "channel" as const };
const dmChannel = { id: "dm-alice-bob", kind: "channel" as const };
const meetingWithRoom = {
  id: "chat-01BX5ZZKBKACTAV9WEVGEMMVRZ",
  kind: "meeting" as const,
  guestRoomCode: "q2w3-e4r5-t6y7",
};
const meetingWithoutRoom = {
  id: "chat-01BX5ZZKBKACTAV9WEVGEMMVS0",
  kind: "meeting" as const,
  guestRoomCode: null,
};

describe("meetChannelRoomId", () => {
  it("uses the lowercased channel id as the deterministic room id", () => {
    expect(meetChannelRoomId(chatChannel)).toBe("chat-01arz3ndektsv4rrffq69g5fav");
    expect(meetChannelRoomId(dmChannel)).toBe("dm-alice-bob");
  });

  it("prefers the reserved guestRoomCode for meeting channels", () => {
    expect(meetChannelRoomId(meetingWithRoom)).toBe("q2w3-e4r5-t6y7");
  });

  it("falls back to the channel id when a meeting has no guest room", () => {
    expect(meetChannelRoomId(meetingWithoutRoom)).toBe(meetingWithoutRoom.id.toLowerCase());
  });

  it("shares the guest room code with guests when the collection id is chat-{code}", () => {
    const meeting = {
      id: "chat-g744-8kfg-adjz",
      kind: "meeting" as const,
      guestRoomCode: null,
    };
    expect(meetChannelRoomId(meeting)).toBe("g744-8kfg-adjz");
    expect(meetChannelRoomId(meeting)).toBe(meetChannelCallRoom(meeting));
    expect(meetChannelRoomId(meetingWithRoom)).toBe(meetChannelCallRoom(meetingWithRoom));
  });
});

describe("meetChannelIdForRoom", () => {
  const channels = [chatChannel, dmChannel, meetingWithRoom];

  it("maps a room code back to its channel case-insensitively", () => {
    expect(meetChannelIdForRoom(channels, "chat-01arz3ndektsv4rrffq69g5fav")).toBe(chatChannel.id);
    expect(meetChannelIdForRoom(channels, "CHAT-01ARZ3NDEKTSV4RRFFQ69G5FAV")).toBe(chatChannel.id);
    expect(meetChannelIdForRoom(channels, "q2w3-e4r5-t6y7")).toBe(meetingWithRoom.id);
  });

  it("returns null for unknown or empty rooms", () => {
    expect(meetChannelIdForRoom(channels, "zzzz-zzzz-zzzz")).toBeNull();
    expect(meetChannelIdForRoom(channels, null)).toBeNull();
    expect(meetChannelIdForRoom(channels, "  ")).toBeNull();
  });
});

describe("meetGuestChatChannelId", () => {
  it("uses the host meeting collection id, not a leftover public slug", () => {
    expect(
      meetGuestChatChannelId({
        channels: [meetingWithRoom],
        invitedRoom: "q2w3-e4r5-t6y7",
        meetingId: "standup",
      }),
    ).toBe(meetingWithRoom.id);
    expect(meetGuestChatChannelId({ invitedRoom: "chat-test", meetingId: "test" })).toBe(
      "chat-test",
    );
    expect(meetGuestChatChannelId({ meetingId: "test" })).toBe("chat-test");
    expect(meetGuestChatChannelId({ invitedRoom: "h8y8-ewp6-al8n" })).toBe("h8y8-ewp6-al8n");
    expect(meetGuestChatChannelId({})).toBe("guest");
  });
});
