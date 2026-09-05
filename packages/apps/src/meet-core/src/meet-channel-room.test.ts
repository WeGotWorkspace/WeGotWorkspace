import { describe, expect, it } from "vitest";
import { meetChannelIdForRoom, meetChannelRoomId } from "@/meet-core/src/meet-channel-room";

const chatChannel = { id: "chat-01ARZ3NDEKTSV4RRFFQ69G5FAV", kind: "channel" as const };
const dmChannel = { id: "dm-alice-bob", kind: "channel" as const };
const meetingWithRoom = {
  id: "chat-01BX5ZZKBKACTAV9WEVGEMMVRZ",
  kind: "meeting" as const,
  guestRoomCode: "q1w2-e3r4-t5y6",
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
    expect(meetChannelRoomId(meetingWithRoom)).toBe("q1w2-e3r4-t5y6");
  });

  it("falls back to the channel id when a meeting has no guest room", () => {
    expect(meetChannelRoomId(meetingWithoutRoom)).toBe(meetingWithoutRoom.id.toLowerCase());
  });
});

describe("meetChannelIdForRoom", () => {
  const channels = [chatChannel, dmChannel, meetingWithRoom];

  it("maps a room code back to its channel case-insensitively", () => {
    expect(meetChannelIdForRoom(channels, "chat-01arz3ndektsv4rrffq69g5fav")).toBe(chatChannel.id);
    expect(meetChannelIdForRoom(channels, "CHAT-01ARZ3NDEKTSV4RRFFQ69G5FAV")).toBe(chatChannel.id);
    expect(meetChannelIdForRoom(channels, "q1w2-e3r4-t5y6")).toBe(meetingWithRoom.id);
  });

  it("returns null for unknown or empty rooms", () => {
    expect(meetChannelIdForRoom(channels, "zzzz-zzzz-zzzz")).toBeNull();
    expect(meetChannelIdForRoom(channels, null)).toBeNull();
    expect(meetChannelIdForRoom(channels, "  ")).toBeNull();
  });
});
