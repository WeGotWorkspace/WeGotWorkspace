import { describe, expect, it } from "vitest";
import { createMeetChatOperations } from "@/lib/api/mock/meet-chat-operations";
import type { ChatLinkPreview } from "@/meet-core/src/meet-types";

const preview: ChatLinkPreview = {
  url: "https://example.com/blog",
  kind: "external",
  title: "Example blog",
};

describe("createMeetChatOperations", () => {
  it("attaches fixture unfurl previews when sending a message", async () => {
    const ops = createMeetChatOperations({
      channels: [],
      messages: [],
      unfurl: { "https://example.com/blog": preview },
      author: { id: "demo.user", displayName: "Demo User" },
    });

    const message = await ops.sendMessage!("channel-general", "See https://example.com/blog");
    expect(message.previews).toEqual([preview]);
  });

  it("creates a meeting channel with a room code and no guest door", async () => {
    const ops = createMeetChatOperations({
      channels: [],
      messages: [],
      author: { id: "demo.user", displayName: "Demo User" },
    });

    const meeting = await ops.createChannel!({ name: "Studio", kind: "meeting" });
    expect(meeting?.kind).toBe("meeting");
    expect(meeting?.guestAccess).toBeUndefined();
    expect(meeting?.guestRoomCode).toMatch(/^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/);
    expect(meeting?.id).toBe(`chat-${meeting?.guestRoomCode}`);
  });

  it("keeps a supplied ad-hoc meeting room code instead of minting a new one", async () => {
    const ops = createMeetChatOperations({
      channels: [],
      messages: [],
      author: { id: "demo.user", displayName: "Demo User" },
    });

    const meeting = await ops.createChannel!({
      name: "Studio",
      kind: "meeting",
      guestRoomCode: "g744-8kfg-adjz",
    });
    expect(meeting?.guestRoomCode).toBe("g744-8kfg-adjz");
    expect(meeting?.id).toBe("chat-g744-8kfg-adjz");
  });

  it("deleteChannel drops the row and its messages", async () => {
    const ops = createMeetChatOperations({
      channels: [
        {
          id: "channel-general",
          name: "General",
          kind: "channel",
          scope: "personal",
        },
        {
          id: "channel-random",
          name: "Random",
          kind: "channel",
          scope: "personal",
        },
      ],
      messages: [
        {
          id: "m1",
          channelId: "channel-general",
          authorId: "demo.user",
          authorName: "Demo User",
          body: "hello",
          createdAt: 1,
          reactions: [],
          mentions: [],
          previews: [],
        },
      ],
      author: { id: "demo.user", displayName: "Demo User" },
    });

    await ops.deleteChannel!("channel-general");
    const state = ops.getState();
    expect(state.channels.map((row) => row.id)).toEqual(["channel-random"]);
    expect(state.messages).toEqual([]);
  });
});
