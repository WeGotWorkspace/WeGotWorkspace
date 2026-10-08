import { describe, expect, it } from "vitest";
import {
  MEET_ROOM_CHAT_TEXT_LIMIT,
  buildMeetChannelChatEcho,
  meetRoomChatEchoBody,
  meetRoomChatEchoId,
  meetRoomChatEchoText,
  parseMeetChannelChatEcho,
} from "@/meet-core/src/meet-channel-chat-echo";
import { meetPollChatLine } from "@/meet-core/src/meet-chat-line";

const SAVED_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

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
    const echo = meetPollChatLine(
      "peer-2",
      "Ada",
      buildMeetChannelChatEcho("saved-1", "hello"),
      "self",
      5,
    );
    expect(echo).toMatchObject({
      body: "hello",
      fromPeerId: "peer-2",
      isSelf: false,
      ts: 5,
      channelMessageId: "saved-1",
    });
    expect(echo.id).toMatch(/^peer-2-/);
    expect(echo.id).not.toBe("saved-1");

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

  it("accepts a saved message id as an echo id", () => {
    expect(meetRoomChatEchoId(SAVED_ID)).toBe(SAVED_ID);
    expect(meetRoomChatEchoId("saved-1")).toBe("saved-1");
    expect(meetRoomChatEchoId(` ${SAVED_ID} `)).toBe(SAVED_ID);
  });

  it("never echoes a local placeholder id", () => {
    expect(meetRoomChatEchoId("local-1710000000000")).toBeNull();
    expect(meetRoomChatEchoId("local-reply-1710000000000")).toBeNull();
  });

  it("rejects an echo id that is not a message id", () => {
    expect(meetRoomChatEchoId(null)).toBeNull();
    expect(meetRoomChatEchoId(undefined)).toBeNull();
    expect(meetRoomChatEchoId("   ")).toBeNull();
    expect(meetRoomChatEchoId("../secret")).toBeNull();
    expect(meetRoomChatEchoId("has space")).toBeNull();
    expect(meetRoomChatEchoId("a".repeat(65))).toBeNull();
  });

  it("caps room echo text at the room text limit", () => {
    const text = meetRoomChatEchoText(SAVED_ID, "x".repeat(2_500));

    expect([...text]).toHaveLength(MEET_ROOM_CHAT_TEXT_LIMIT);
    expect(parseMeetChannelChatEcho(text)?.id).toBe(SAVED_ID);
  });

  it("reports the echo body a peer reads back for a saved row", () => {
    expect(meetRoomChatEchoBody(SAVED_ID, " hello ")).toBe("hello");
    expect(meetRoomChatEchoBody(SAVED_ID, "x".repeat(2_500))).toBe(
      parseMeetChannelChatEcho(meetRoomChatEchoText(SAVED_ID, "x".repeat(2_500)))?.body,
    );
    expect(meetRoomChatEchoBody(SAVED_ID, "")).toBe("");
  });
});
