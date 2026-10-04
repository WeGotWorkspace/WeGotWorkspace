import { describe, expect, it } from "vitest";
import { meetRoomChatEchoText } from "@/meet-core/src/meet-channel-chat-echo";
import {
  appendMeetRoomChatLine,
  meetPollChatLine,
  mergeMeetRoomChatIntoChannel,
  type MeetChatLine,
} from "@/meet-core/src/meet-chat-line";
import type { ChatMessage } from "@/meet-core/src/meet-types";
import { buildMeetControlMessage } from "@/meet-core/src/meet-control-messages";
import { acceptMeetDataChat } from "@/meet-core/src/meet-data-chat";

const CLIENT_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

function apply(
  raw: string,
  names: ReadonlyMap<string, string>,
  remoteId = "peer-2",
): MeetChatLine[] {
  let lines: MeetChatLine[] = [];
  acceptMeetDataChat({
    remoteId,
    raw,
    selfPeerId: "self-1",
    peerNames: names,
    setChatMessages: (value) => {
      lines = typeof value === "function" ? value(lines) : value;
    },
  });
  return lines;
}

describe("acceptMeetDataChat", () => {
  it("names the sender from the connection and the roster", () => {
    const lines = apply(
      JSON.stringify({
        t: "chat",
        id: CLIENT_ID,
        text: " hello ",
        ts: 10,
        from: "forged",
        name: "Mallory",
      }),
      new Map([["peer-2", "Ada"]]),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      fromPeerId: "peer-2",
      fromName: "Ada",
      body: "hello",
      clientId: CLIENT_ID,
      isSelf: false,
    });
    expect(lines[0]?.id).not.toBe(CLIENT_ID);
    expect(lines[0]?.channelMessageId).toBe(CLIENT_ID);
  });

  it("hides the data-channel copy once the channel row is saved", () => {
    const [line] = apply(
      JSON.stringify({ t: "chat", id: CLIENT_ID, text: "hello", ts: 10 }),
      new Map([["peer-2", "Ada"]]),
    );
    const saved: ChatMessage = {
      id: CLIENT_ID,
      channelId: "chat-test",
      authorId: "user-1",
      authorName: "Ada",
      body: "hello",
      createdAt: 1,
      reactions: [],
      mentions: [],
      previews: [],
    };
    expect(line).toBeDefined();
    expect(mergeMeetRoomChatIntoChannel([saved], [line!], "chat-test")).toEqual([saved]);
  });

  it("dedupes the later HTTP copy on sender and ULID, not on the id alone", () => {
    const first = apply(
      JSON.stringify({ t: "chat", id: CLIENT_ID, text: "hello", ts: 10 }),
      new Map([["peer-2", "Ada"]]),
    );
    const withHttp = appendMeetRoomChatLine(
      first,
      meetPollChatLine("peer-2", "Ada", meetRoomChatEchoText(CLIENT_ID, "hello"), "self-1"),
    );
    expect(withHttp).toHaveLength(1);

    const otherPeer = appendMeetRoomChatLine(
      withHttp,
      meetPollChatLine("peer-3", "Bea", meetRoomChatEchoText(CLIENT_ID, "other"), "self-1"),
    );
    expect(otherPeer.map((line) => line.fromPeerId)).toEqual(["peer-2", "peer-3"]);
  });

  it("does not run admit or mute that arrives on the data channel", () => {
    const admit = apply(
      JSON.stringify({
        t: "chat",
        id: CLIENT_ID,
        text: buildMeetControlMessage({ kind: "admit", peerId: "self-1" }),
        ts: 10,
      }),
      new Map([["peer-2", "Ada"]]),
    );
    const mute = apply(
      JSON.stringify({
        t: "chat",
        id: "01ARZ3NDEKTSV4RRFFQ69G5FAW",
        text: buildMeetControlMessage({ kind: "mute", peerId: "self-1" }),
        ts: 11,
      }),
      new Map([["peer-2", "Ada"]]),
    );
    expect(admit).toEqual([]);
    expect(mute).toEqual([]);
  });
});
