import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WgwChatChannel } from "@/lib/api/wgw/meet-chat";
import { MeetChatRequestError } from "@/lib/api/wgw/meet-chat";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import {
  ingestRemoteChatChannel,
  ingestRemoteChatMessage,
} from "@/lib/offline/meet-chat-jmap-inbound";
import {
  meetChatChannelsTable,
  meetChatMessagesTable,
} from "@/lib/offline/meet-chat/meet-chat-schema";
import {
  getCachedChatMessage,
  listCachedChatChannels,
} from "@/lib/offline/meet-chat-offline-store";
import {
  applyMeetMeshFanoutEvent,
  wrapMeetChatOperationsWithMesh,
} from "@/meet-core/src/meet-mesh-sot";
import type { ChatMessage, MeetChannel, MeetChatOperations } from "@/meet-core/src/meet-types";
import type { PresenceEnvelope } from "@/presence-core/src/presence-types";

const username = "alice";

function wireChannel(id: string, name = id): WgwChatChannel {
  return {
    id,
    name,
    kind: "channel",
    scope: "personal",
    groupSlug: null,
    isSharee: false,
    myRights: {
      mayReadItems: true,
      mayWriteAll: true,
      mayWriteOwn: true,
      mayUpdatePrivate: true,
      mayRSVP: true,
      mayAdmin: true,
      mayDelete: true,
      mayShare: true,
    },
  } as WgwChatChannel;
}

function message(overrides: Partial<ChatMessage> & Pick<ChatMessage, "id">): ChatMessage {
  return {
    channelId: "chat-general",
    authorId: "bob",
    authorName: "Bob",
    body: "hello",
    createdAt: 1_700_000_000_000,
    reactions: [],
    mentions: [],
    previews: [],
    parentId: null,
    threadId: null,
    replyCount: 0,
    ...overrides,
  };
}

describe("applyMeetMeshFanoutEvent", () => {
  beforeEach(async () => {
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await db.outbox.clear();
    await db.meta.clear();
    await meetChatChannelsTable(db).clear();
    await meetChatMessagesTable(db).clear();
  });

  it("upserts a new reply and increments the parent replyCount once", async () => {
    await ingestRemoteChatChannel(username, wireChannel("chat-general"));
    await ingestRemoteChatMessage(
      username,
      message({ id: "01ARZ3NDEKTSV4RRFFQ69G5FAA", replyCount: 0 }),
    );
    const result = await applyMeetMeshFanoutEvent({
      username,
      knownChannelIds: new Set(["chat-general"]),
      event: {
        kind: "channel-message",
        senderUsername: "bob",
        message: {
          id: "01ARZ3NDEKTSV4RRFFQ69G5FAB",
          channelId: "chat-general",
          authorId: "bob",
          authorName: "Bob",
          body: "reply",
          createdAt: 1_700_000_000_100,
          parentId: "01ARZ3NDEKTSV4RRFFQ69G5FAA",
        },
      },
    });
    expect(result).toBe("applied");
    expect((await getCachedChatMessage(username, "01ARZ3NDEKTSV4RRFFQ69G5FAA"))?.replyCount).toBe(
      1,
    );

    await applyMeetMeshFanoutEvent({
      username,
      knownChannelIds: new Set(["chat-general"]),
      event: {
        kind: "channel-message",
        senderUsername: "bob",
        message: {
          id: "01ARZ3NDEKTSV4RRFFQ69G5FAB",
          channelId: "chat-general",
          authorId: "bob",
          authorName: "Bob",
          body: "reply",
          createdAt: 1_700_000_000_100,
          parentId: "01ARZ3NDEKTSV4RRFFQ69G5FAA",
        },
      },
    });
    expect((await getCachedChatMessage(username, "01ARZ3NDEKTSV4RRFFQ69G5FAA"))?.replyCount).toBe(
      1,
    );
  });

  it("patches body when the sender authored the cached message", async () => {
    await ingestRemoteChatChannel(username, wireChannel("chat-general"));
    await ingestRemoteChatMessage(
      username,
      message({
        id: "01ARZ3NDEKTSV4RRFFQ69G5FAA",
        reactions: [{ emoji: "👍", authors: ["alice"] }],
      }),
    );
    const result = await applyMeetMeshFanoutEvent({
      username,
      knownChannelIds: new Set(["chat-general"]),
      event: {
        kind: "channel-message-patch",
        senderUsername: "bob",
        id: "01ARZ3NDEKTSV4RRFFQ69G5FAA",
        channel: "chat-general",
        body: "edited",
        editedAt: 9,
      },
    });
    expect(result).toBe("applied");
    const saved = await getCachedChatMessage(username, "01ARZ3NDEKTSV4RRFFQ69G5FAA");
    expect(saved?.body).toBe("edited");
    expect(saved?.editedAt).toBe(9);
    expect(saved?.reactions).toEqual([{ emoji: "👍", authors: ["alice"] }]);
  });

  it("drops an edit when the sender is not the author", async () => {
    await ingestRemoteChatMessage(username, message({ id: "01ARZ3NDEKTSV4RRFFQ69G5FAA" }));
    const result = await applyMeetMeshFanoutEvent({
      username,
      knownChannelIds: new Set(["chat-general"]),
      event: {
        kind: "channel-message-patch",
        senderUsername: "mallory",
        id: "01ARZ3NDEKTSV4RRFFQ69G5FAA",
        channel: "chat-general",
        body: "hacked",
        editedAt: 9,
      },
    });
    expect(result).toBe("dropped");
    expect((await getCachedChatMessage(username, "01ARZ3NDEKTSV4RRFFQ69G5FAA"))?.body).toBe(
      "hello",
    );
  });

  it("tombstones a destroy from the author", async () => {
    await ingestRemoteChatMessage(username, message({ id: "01ARZ3NDEKTSV4RRFFQ69G5FAA" }));
    const result = await applyMeetMeshFanoutEvent({
      username,
      knownChannelIds: new Set(["chat-general"]),
      event: {
        kind: "channel-message-destroy",
        senderUsername: "bob",
        id: "01ARZ3NDEKTSV4RRFFQ69G5FAA",
        channel: "chat-general",
      },
    });
    expect(result).toBe("applied");
    const saved = await getCachedChatMessage(username, "01ARZ3NDEKTSV4RRFFQ69G5FAA");
    expect(saved?.body).toBe("");
    expect(saved?.deletedAt).toBeTypeOf("number");
  });

  it("applies an absolute reaction from the sender", async () => {
    await ingestRemoteChatMessage(username, message({ id: "01ARZ3NDEKTSV4RRFFQ69G5FAA" }));
    await applyMeetMeshFanoutEvent({
      username,
      knownChannelIds: new Set(["chat-general"]),
      event: {
        kind: "channel-reaction",
        senderUsername: "bob",
        messageId: "01ARZ3NDEKTSV4RRFFQ69G5FAA",
        channel: "chat-general",
        emoji: "👍",
        on: true,
      },
    });
    expect((await getCachedChatMessage(username, "01ARZ3NDEKTSV4RRFFQ69G5FAA"))?.reactions).toEqual(
      [{ emoji: "👍", authors: ["bob"] }],
    );
    await applyMeetMeshFanoutEvent({
      username,
      knownChannelIds: new Set(["chat-general"]),
      event: {
        kind: "channel-reaction",
        senderUsername: "bob",
        messageId: "01ARZ3NDEKTSV4RRFFQ69G5FAA",
        channel: "chat-general",
        emoji: "👍",
        on: false,
      },
    });
    expect((await getCachedChatMessage(username, "01ARZ3NDEKTSV4RRFFQ69G5FAA"))?.reactions).toEqual(
      [],
    );
  });

  it("fetches a channel-changed ping and drops DMs", async () => {
    const fetchChannel = vi.fn().mockResolvedValue(wireChannel("chat-new", "New"));
    const applied = await applyMeetMeshFanoutEvent({
      username,
      knownChannelIds: new Set(),
      fetchChannel,
      event: { kind: "channel-changed", senderUsername: "bob", channel: "chat-new" },
    });
    expect(applied).toBe("applied");
    expect((await listCachedChatChannels(username)).map((row) => row.id)).toEqual(["chat-new"]);

    const dm = await applyMeetMeshFanoutEvent({
      username,
      knownChannelIds: new Set(),
      fetchChannel,
      event: { kind: "channel-changed", senderUsername: "bob", channel: "dm:alice" },
    });
    expect(dm).toBe("dropped");
    expect(fetchChannel).toHaveBeenCalledTimes(1);
  });

  it("destroys a local channel when the ping fetch is gone", async () => {
    await ingestRemoteChatChannel(username, wireChannel("chat-old"));
    const fetchChannel = vi.fn().mockRejectedValue(new MeetChatRequestError("gone", 404));
    const result = await applyMeetMeshFanoutEvent({
      username,
      knownChannelIds: new Set(["chat-old"]),
      fetchChannel,
      event: { kind: "channel-changed", senderUsername: "bob", channel: "chat-old" },
    });
    expect(result).toBe("applied");
    expect(await listCachedChatChannels(username)).toEqual([]);
  });
});

describe("wrapMeetChatOperationsWithMesh", () => {
  const channel: MeetChannel = {
    id: "chat-general",
    name: "general",
    kind: "channel",
    scope: "personal",
    shareWith: { bob: { mayRead: true } },
  };

  function port() {
    const sent: Array<{ usernames: readonly string[]; envelope: PresenceEnvelope }> = [];
    return {
      sent,
      sendToUsernames: (usernames: readonly string[], envelope: PresenceEnvelope) => {
        sent.push({ usernames, envelope });
      },
      targetsFor: () => ["bob"],
      resolveMessage: async (id: string) =>
        id === "m1" ? message({ id: "m1", authorId: "alice", authorName: "Alice" }) : undefined,
    };
  }

  it("fans edit, delete, react, and channel-changed after successful writes", async () => {
    const ops: MeetChatOperations = {
      editMessage: vi.fn().mockResolvedValue(
        message({
          id: "m1",
          authorId: "alice",
          authorName: "Alice",
          body: "edited",
          editedAt: 4,
        }),
      ),
      deleteMessage: vi.fn().mockResolvedValue(undefined),
      react: vi.fn().mockResolvedValue(
        message({
          id: "m1",
          authorId: "bob",
          reactions: [{ emoji: "🎉", authors: ["alice"] }],
        }),
      ),
      createChannel: vi.fn().mockResolvedValue(channel),
      deleteChannel: vi.fn().mockResolvedValue(undefined),
    };
    const mesh = port();
    const wrapped = wrapMeetChatOperationsWithMesh(ops, "alice", null, mesh);

    await wrapped.editMessage!("m1", "edited");
    await wrapped.deleteMessage!("m1");
    await wrapped.react!("m1", "🎉");
    await wrapped.createChannel!({ name: "general", kind: "channel" });
    await wrapped.deleteChannel!("chat-general");

    expect(mesh.sent.map((row) => row.envelope.kind)).toEqual([
      "channel-message-patch",
      "channel-message-destroy",
      "channel-reaction",
      "channel-changed",
      "channel-changed",
    ]);
    expect(mesh.sent[2]?.envelope).toMatchObject({
      kind: "channel-reaction",
      on: true,
      emoji: "🎉",
    });
  });

  it("fans call-active with audioOnly when startCall sets video false", async () => {
    const startCall = vi.fn().mockResolvedValue(undefined);
    const leaveCall = vi.fn().mockResolvedValue(undefined);
    const mesh = port();
    const wrapped = wrapMeetChatOperationsWithMesh(
      { startCall, leaveCall },
      "alice",
      "chat-general",
      mesh,
    );

    await wrapped.startCall!("chat-general", { video: false });
    await wrapped.startCall!("chat-general");
    await wrapped.leaveCall!("chat-general");

    expect(mesh.sent.map((row) => row.envelope)).toEqual([
      { v: 1, kind: "call-active", channel: "chat-general", active: true, audioOnly: true },
      { v: 1, kind: "call-active", channel: "chat-general", active: true },
      { v: 1, kind: "call-active", channel: "chat-general", active: false },
    ]);
  });
});
