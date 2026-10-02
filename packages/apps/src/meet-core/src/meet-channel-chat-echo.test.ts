import { describe, expect, it } from "vitest";
import {
  buildMeetChannelChatEcho,
  meetPollChatLine,
  meetRoomChatOutbound,
  parseMeetChannelChatEcho,
} from "@/meet-core/src/meet-channel-chat-echo";
import type { ChatMessage } from "@/meet-core/src/meet-types";

function saved(id: string, body: string): ChatMessage {
  return {
    id,
    channelId: "chan-1",
    authorId: "user-1",
    authorName: "Ada",
    body,
    createdAt: 1,
    reactions: [],
    mentions: [],
    previews: [],
  };
}

describe("meet channel chat echo", () => {
  it("round-trips a saved message id and body", () => {
    const wire = buildMeetChannelChatEcho("saved-1", "hello");
    expect(wire).toBe("__wgw_meet_channel_chat__:saved-1\nhello");
    expect(parseMeetChannelChatEcho(wire)).toEqual({ id: "saved-1", body: "hello" });
  });

  it("keeps a multiline body after the id line", () => {
    expect(parseMeetChannelChatEcho(buildMeetChannelChatEcho("saved-1", "hello\nthere"))).toEqual({
      id: "saved-1",
      body: "hello\nthere",
    });
  });

  it("rejects caller text that is not a saved-message echo", () => {
    expect(parseMeetChannelChatEcho("hello")).toBeNull();
    expect(parseMeetChannelChatEcho("__wgw_meet_channel_chat__:saved-1")).toBeNull();
    expect(parseMeetChannelChatEcho("__wgw_meet_channel_chat__:\nhello")).toBeNull();
    expect(parseMeetChannelChatEcho("__wgw_meet_channel_chat__:../secret\nhello")).toBeNull();
    expect(parseMeetChannelChatEcho("__wgw_meet_channel_chat__:has space\nhello")).toBeNull();
    expect(
      parseMeetChannelChatEcho(`__wgw_meet_channel_chat__:${"a".repeat(65)}\nhello`),
    ).toBeNull();
    expect(parseMeetChannelChatEcho("__wgw_meet_channel_chat__:saved-1\n   ")).toBeNull();
    expect(parseMeetChannelChatEcho('__wgw_meet_control__:{"kind":"end","by":"Ada"}')).toBeNull();
  });

  it("stores a parsed echo under the saved id and leaves plain text alone", () => {
    expect(
      meetPollChatLine("peer-2", "Ada", buildMeetChannelChatEcho("saved-1", "hello"), "self", 5),
    ).toMatchObject({
      id: "saved-1",
      body: "hello",
      fromPeerId: "peer-2",
      isSelf: false,
      ts: 5,
    });

    const plain = meetPollChatLine("peer-2", "Ada", "from guest", "self", 5);
    expect(plain.body).toBe("from guest");
    expect(plain.id).toMatch(/^peer-2-/);

    const malformed = meetPollChatLine(
      "peer-2",
      "Ada",
      "__wgw_meet_channel_chat__:../secret\nhello",
      "self",
      5,
    );
    expect(malformed.body).toBe("__wgw_meet_channel_chat__:../secret\nhello");
    expect(malformed.id).not.toBe("../secret");
  });

  it("echoes a saved channel message and keeps plain text otherwise", async () => {
    await expect(meetRoomChatOutbound("hello")).resolves.toEqual({ text: "hello", saved: false });
    await expect(meetRoomChatOutbound("hello", Promise.resolve(null))).resolves.toEqual({
      text: "hello",
      saved: false,
    });
    await expect(meetRoomChatOutbound("hello", Promise.reject(new Error("nope")))).resolves.toEqual(
      {
        text: "hello",
        saved: false,
      },
    );
    await expect(
      meetRoomChatOutbound("hello", Promise.resolve(saved("saved-1", " hello "))),
    ).resolves.toEqual({
      text: "__wgw_meet_channel_chat__:saved-1\nhello",
      saved: true,
    });
    await expect(
      meetRoomChatOutbound("hello", Promise.resolve(saved("../secret", "hello"))),
    ).resolves.toEqual({
      text: "hello",
      saved: true,
    });
  });
});
