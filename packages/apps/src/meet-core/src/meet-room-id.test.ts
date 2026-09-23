import { describe, expect, it } from "vitest";
import { MEET_ROOM_CODE_PATTERN } from "@/calendar-core/src/calendar-meet-link";
import { createMeetPeerId, createMeetRoomCode } from "@/meet-core/src/meet-room-id";

describe("meet room id", () => {
  it("creates peer ids with the expected alphabet length", () => {
    const peerId = createMeetPeerId();
    expect(peerId).toMatch(/^[A-Z2-9]{10}$/);
    expect(createMeetPeerId(6)).toHaveLength(6);
  });

  it("creates room codes in xxxx-xxxx-xxxx format", () => {
    const room = createMeetRoomCode();
    expect(room).toMatch(MEET_ROOM_CODE_PATTERN);
  });
});
