import { describe, expect, it, vi } from "vitest";
import {
  buildLocalMeetChatLine,
  buildMeetChatLineFromPoll,
  meetChatLineToChannelMessage,
  mergeMeetRoomChatIntoChannel,
} from "@/meet-core/src/meet-chat-line";

describe("meet chat line", () => {
  it("builds poll chat lines with self detection", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    vi.spyOn(Math, "random").mockReturnValue(0.123456);

    expect(
      buildMeetChatLineFromPoll("peer-a", "Host", " hello ", "peer-b", 1_700_000_000_000),
    ).toMatchObject({
      fromPeerId: "peer-a",
      fromName: "Host",
      body: "hello",
      ts: 1_700_000_000_000,
      isSelf: false,
    });
    expect(buildMeetChatLineFromPoll("peer-a", "Host", " hello ", "peer-b").id).toMatch(
      /^peer-a-\d+-[a-f0-9]+$/,
    );

    expect(
      buildMeetChatLineFromPoll("peer-a", "You", "hi", "peer-a", 1_700_000_000_000).isSelf,
    ).toBe(true);
  });

  it("builds optimistic local chat lines", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    vi.spyOn(Math, "random").mockReturnValue(0.654321);

    expect(buildLocalMeetChatLine("peer-a", "You", " hello ", 1_700_000_000_000)).toMatchObject({
      fromPeerId: "peer-a",
      fromName: "You",
      body: "hello",
      ts: 1_700_000_000_000,
      isSelf: true,
    });
    expect(buildLocalMeetChatLine("peer-a", "You", "hello").id).toMatch(/^me-\d+-[a-f0-9]+$/);
  });

  it("maps room chat lines onto channel messages for the guest rail", () => {
    const line = buildLocalMeetChatLine("peer-a", "Ada", "hello", 1_700_000_000_000);
    expect(meetChatLineToChannelMessage(line, "guest-room")).toMatchObject({
      id: line.id,
      channelId: "guest-room",
      authorId: "peer-a",
      authorName: "Ada",
      body: "hello",
      createdAt: 1_700_000_000_000,
      reactions: [],
      mentions: [],
      previews: [],
    });
  });

  it("merges guest room-poll lines into the host channel thread", () => {
    const channel = meetChatLineToChannelMessage(
      buildLocalMeetChatLine("admin", "Admin", "from host", 1),
      "chat-test",
    );
    const guestLine = buildMeetChatLineFromPoll("guest-1", "Ada", "from guest", "admin", 2);
    const selfEcho = buildLocalMeetChatLine("admin", "Admin", "echo", 3);
    const merged = mergeMeetRoomChatIntoChannel([channel], [guestLine, selfEcho], "chat-test");
    expect(merged.map((row) => row.body)).toEqual(["from host", "from guest"]);
    expect(merged[1]?.channelId).toBe("chat-test");
  });
});
