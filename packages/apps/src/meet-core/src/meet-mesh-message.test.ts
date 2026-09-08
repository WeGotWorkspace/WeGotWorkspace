import { describe, expect, it } from "vitest";
import {
  meetMeshChatMessageFromApp,
  meetMeshChatMessageToApp,
  meetMeshReceiveChannelId,
} from "@/meet-core/src/meet-mesh-message";
import type { ChatMessage } from "@/meet-core/src/meet-types";

const sample: ChatMessage = {
  id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
  channelId: "dm:bob",
  authorId: "alice",
  authorName: "Alice",
  body: "hello",
  createdAt: 1_700_000_000_000,
  reactions: [{ emoji: "👍", authors: ["bob"] }],
  mentions: [{ id: "bob", displayName: "Bob" }],
  previews: [],
  parentId: null,
  threadId: null,
};

describe("meetMeshChatMessage", () => {
  it("strips client-only fields for the wire payload", () => {
    expect(meetMeshChatMessageFromApp(sample)).toEqual({
      id: sample.id,
      channelId: "dm:bob",
      authorId: "alice",
      authorName: "Alice",
      body: "hello",
      createdAt: sample.createdAt,
      parentId: null,
    });
  });

  it("rehydrates a ChatMessage with empty reactions/previews", () => {
    const app = meetMeshChatMessageToApp(meetMeshChatMessageFromApp(sample));
    expect(app.reactions).toEqual([]);
    expect(app.mentions).toEqual([]);
    expect(app.channelId).toBe("dm:bob");
    expect(app.threadId).toBeNull();
  });

  it("rewrites the sender's dm:{peer} onto the receiver's dm:{sender}", () => {
    expect(meetMeshReceiveChannelId("dm:bob", "alice")).toBe("dm:alice");
    expect(meetMeshReceiveChannelId("chat-general", "alice")).toBe("chat-general");
  });
});
