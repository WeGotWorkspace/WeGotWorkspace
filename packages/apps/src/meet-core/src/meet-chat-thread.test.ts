import { describe, expect, it } from "vitest";
import {
  meetChannelMessages,
  meetThreadParent,
  meetThreadReplies,
  upsertMeetChatMessage,
} from "@/meet-core/src/meet-chat-thread";
import type { ChatMessage } from "@/meet-core/src/meet-types";

function message(
  partial: Partial<ChatMessage> & Pick<ChatMessage, "id" | "channelId">,
): ChatMessage {
  return {
    authorId: "ada.lovelace",
    authorName: "Ada Lovelace",
    body: "Hello",
    createdAt: 1,
    reactions: [],
    mentions: [],
    previews: [],
    ...partial,
  };
}

const parent = message({ id: "msg-1", channelId: "general", threadId: "msg-1", replyCount: 1 });
const reply = message({
  id: "msg-1a",
  channelId: "general",
  parentId: "msg-1",
  threadId: "msg-1",
});
const other = message({ id: "msg-2", channelId: "design" });

describe("meet chat thread helpers", () => {
  it("lists top-level channel messages", () => {
    expect(meetChannelMessages([parent, reply, other], "general")).toEqual([parent]);
  });

  it("resolves a thread parent from a reply", () => {
    expect(meetThreadParent([parent, reply], "msg-1a")).toEqual(parent);
    expect(meetThreadParent([parent, reply], "msg-1")).toEqual(parent);
  });

  it("lists replies for a parent", () => {
    expect(meetThreadReplies([parent, reply, other], "msg-1")).toEqual([reply]);
  });

  it("upserts messages by id", () => {
    const edited = { ...parent, body: "Updated" };
    expect(upsertMeetChatMessage([parent], edited)).toEqual([edited]);
    expect(upsertMeetChatMessage([parent], other)).toEqual([parent, other]);
  });
});
