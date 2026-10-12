import { describe, expect, it, vi } from "vitest";
import {
  buildMeetChannelChatEcho,
  meetRoomChatEchoText,
} from "@/meet-core/src/meet-channel-chat-echo";
import {
  buildLocalMeetChatLine,
  buildMeetChatLineFromPoll,
  meetChatLineToChannelMessage,
  meetPollChatLine,
  mergeMeetRoomChatIntoChannel,
  type MeetChatLine,
} from "@/meet-core/src/meet-chat-line";
import type { ChatMessage } from "@/meet-core/src/meet-types";

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

  it("merges guest room-poll lines and always keeps the sender's own line", () => {
    const channel = meetChatLineToChannelMessage(
      buildLocalMeetChatLine("admin", "Admin", "from host", 1),
      "chat-test",
    );
    const guestLine = buildMeetChatLineFromPoll("guest-1", "Ada", "from guest", "admin", 2);
    const selfLine = buildLocalMeetChatLine("admin", "Admin", "echo", 3);
    const merged = mergeMeetRoomChatIntoChannel([channel], [guestLine, selfLine], "chat-test");
    expect(merged.map((row) => row.body)).toEqual(["from host", "from guest", "echo"]);
    expect(merged[1]?.channelId).toBe("chat-test");
    expect(merged[2]?.authorId).toBe("admin");

    const alreadyLanded = meetChatLineToChannelMessage(
      buildLocalMeetChatLine("admin", "Admin", "echo", 1),
      "chat-test",
    );
    const repeated = mergeMeetRoomChatIntoChannel([alreadyLanded], [selfLine], "chat-test");
    expect(repeated.map((row) => row.body)).toEqual(["echo", "echo"]);
  });

  it("drops a room line that carries the saved channel message id", () => {
    const saved: ChatMessage = {
      id: "saved-1",
      channelId: "chat-test",
      authorId: "user-1",
      authorName: "Ada",
      body: "hello",
      createdAt: 1,
      reactions: [],
      mentions: [],
      previews: [],
    };
    const echo: MeetChatLine = {
      id: "saved-1",
      fromPeerId: "peer-2",
      fromName: "Ada",
      body: "hello",
      ts: 2,
      isSelf: false,
    };
    const edited = { ...saved, body: "hello world", editedAt: 3 };
    const deleted = { ...saved, body: "", deletedAt: 4, previews: [], mentions: [] };

    expect(mergeMeetRoomChatIntoChannel([saved], [echo], "chat-test")).toEqual([saved]);
    expect(
      mergeMeetRoomChatIntoChannel([edited], [echo], "chat-test").map((row) => row.body),
    ).toEqual(["hello world"]);
    expect(mergeMeetRoomChatIntoChannel([deleted], [echo], "chat-test")).toEqual([deleted]);
  });

  it("shows a room line that was never saved on the channel", () => {
    const saved: ChatMessage = {
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      channelId: "chat-test",
      authorId: "member",
      authorName: "Member",
      body: "ok",
      createdAt: 1,
      reactions: [],
      mentions: [],
      previews: [],
    };
    const admitted: MeetChatLine = {
      id: "VISITOR-1710000000000-ab12",
      fromPeerId: "VISITOR",
      fromName: "Visitor",
      body: "from the lobby",
      ts: 2,
      isSelf: false,
    };
    const copy: MeetChatLine = {
      id: "PEERID-1710000000000-cd34",
      fromPeerId: "PEERID",
      fromName: "Member",
      body: "ok",
      ts: 3,
      isSelf: false,
      channelMessageId: saved.id,
    };
    const merged = mergeMeetRoomChatIntoChannel([saved], [admitted, copy], "chat-test");

    expect(merged.map((row) => row.body)).toEqual(["ok", "from the lobby"]);
    expect(merged.map((row) => row.id)).toEqual([saved.id, admitted.id]);
  });

  it("drops a channel echo even when its id is not the channel row", () => {
    const saved: ChatMessage = {
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      channelId: "chat-test",
      authorId: "member",
      authorName: "Member",
      body: "ok",
      createdAt: 1,
      reactions: [],
      mentions: [],
      previews: [],
    };
    const echo: MeetChatLine = {
      id: "PEERID-1710000000000-ab12",
      fromPeerId: "PEERID",
      fromName: "Member",
      body: "ok",
      ts: 2,
      isSelf: false,
      channelMessageId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    };

    expect(mergeMeetRoomChatIntoChannel([saved], [echo], "chat-test")).toEqual([saved]);
  });
});

describe("mergeMeetRoomChatIntoChannel echo matching", () => {
  const saved: ChatMessage = {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    channelId: "chat-test",
    authorId: "member",
    authorName: "Member",
    body: "ok",
    createdAt: 1,
    reactions: [],
    mentions: [],
    previews: [],
  };

  /** A peer's room line as the poll delivers it, echo marker and all. */
  function roomLine(text: string): MeetChatLine {
    return meetPollChatLine("PEERID", "Mallory", text, "self-1", 2);
  }

  it("shows a forged echo whose id is not in the channel", () => {
    const line = roomLine(buildMeetChannelChatEcho("01ARZ3NDEKTSV4RRFFQ69G5FB0", "guests only"));

    const merged = mergeMeetRoomChatIntoChannel([saved], [line], "chat-test");

    expect(merged.map((row) => row.body)).toEqual(["ok", "guests only"]);
  });

  it("shows a forged echo that claims a real id with different text", () => {
    const line = roomLine(buildMeetChannelChatEcho(saved.id, "guests only"));

    const merged = mergeMeetRoomChatIntoChannel([saved], [line], "chat-test");

    expect(merged.map((row) => row.body)).toEqual(["ok", "guests only"]);
  });

  it("shows a real echo once before the channel row lands and once after", () => {
    const line = roomLine(buildMeetChannelChatEcho(saved.id, "ok"));

    expect(mergeMeetRoomChatIntoChannel([], [line], "chat-test").map((row) => row.body)).toEqual([
      "ok",
    ]);
    expect(mergeMeetRoomChatIntoChannel([saved], [line], "chat-test")).toEqual([saved]);
  });

  it("matches a real echo that the room text limit truncated", () => {
    const row = { ...saved, body: "x".repeat(2_500) };
    const line = roomLine(meetRoomChatEchoText(row.id, row.body));

    expect(line.body).not.toBe(row.body);
    expect(mergeMeetRoomChatIntoChannel([row], [line], "chat-test")).toEqual([row]);
  });

  it("matches a real echo that differs only in surrounding whitespace", () => {
    const row = { ...saved, body: "  ok  " };
    const line = roomLine(buildMeetChannelChatEcho(row.id, "ok"));

    expect(mergeMeetRoomChatIntoChannel([row], [line], "chat-test")).toEqual([row]);
  });
});
