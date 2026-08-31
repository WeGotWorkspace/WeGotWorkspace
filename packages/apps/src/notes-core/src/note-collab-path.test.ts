import { describe, expect, it } from "vitest";
import { encodeFileRoomId } from "@/lib/rtc/room-id";
import { encodeNoteRoomId } from "@/notes-core/src/note-collab-path";

describe("encodeNoteRoomId", () => {
  it("encodes the VJOURNAL UID, not a Drive .notes path", () => {
    const uid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    expect(encodeNoteRoomId(uid)).toBe(encodeFileRoomId(uid));
    expect(encodeNoteRoomId(uid)).not.toContain(".notes");
  });
});
