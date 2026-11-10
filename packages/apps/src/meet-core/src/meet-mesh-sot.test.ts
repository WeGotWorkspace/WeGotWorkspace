import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WgwChatChannel } from "@/lib/api/wgw/meet-chat";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import {
  ingestRemoteChatChannel,
  ingestRemoteChatMessage,
} from "@/lib/offline/meet-chat-jmap-inbound";
import {
  meetChatChannelsTable,
  meetChatMessagesTable,
} from "@/lib/offline/meet-chat/meet-chat-schema";
import { getCachedChatMessage } from "@/lib/offline/meet-chat-offline-store";
import {
  applyMeetMeshFanoutEvent,
  wrapMeetChatOperationsWithMesh,
} from "@/meet-core/src/meet-mesh-sot";
import type { ChatMessage, MeetChannel, MeetChatOperations } from "@/lib/models/meet-types";
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

const generalAcl = {
  channels: [
    {
      id: "chat-general",
      name: "general",
      kind: "channel" as const,
      scope: "personal" as const,
      shareWith: { bob: { mayRead: true } },
    } satisfies MeetChannel,
  ],
};

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
      acl: generalAcl,
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
      acl: generalAcl,
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

  it("drops a channel-message when the sender is not in shareWith", async () => {
    await ingestRemoteChatChannel(username, wireChannel("chat-general"));
    const result = await applyMeetMeshFanoutEvent({
      username,
      knownChannelIds: new Set(["chat-general"]),
      acl: generalAcl,
      event: {
        kind: "channel-message",
        senderUsername: "mallory",
        message: {
          id: "01ARZ3NDEKTSV4RRFFQ69G5FAC",
          channelId: "chat-general",
          authorId: "mallory",
          authorName: "Mallory",
          body: "spoof",
          createdAt: 1_700_000_000_200,
        },
      },
    });
    expect(result).toBe("dropped");
    expect(await getCachedChatMessage(username, "01ARZ3NDEKTSV4RRFFQ69G5FAC")).toBeUndefined();
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
      acl: generalAcl,
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
      acl: generalAcl,
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
      acl: generalAcl,
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
      acl: generalAcl,
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
      acl: generalAcl,
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
    const checkNow: Array<readonly string[]> = [];
    return {
      sent,
      checkNow,
      sendToUsernames: (usernames: readonly string[], envelope: PresenceEnvelope) => {
        sent.push({ usernames, envelope });
      },
      sendCheckNow: (usernames: readonly string[]) => {
        checkNow.push(usernames);
      },
      targetsFor: () => ["bob"],
      resolveMessage: async (id: string) =>
        id === "m1" ? message({ id: "m1", authorId: "alice", authorName: "Alice" }) : undefined,
    };
  }

  it("fans edit, delete, react previews and a check-now after every successful write", async () => {
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

    // Channel create and delete send no preview any more, only check-now (#1662).
    expect(mesh.sent.map((row) => row.envelope.kind)).toEqual([
      "channel-message-patch",
      "channel-message-destroy",
      "channel-reaction",
    ]);
    expect(mesh.checkNow).toEqual([["bob"], ["bob"], ["bob"], ["bob"], ["bob"]]);
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

  it("fans the message preview and a check-now after sendMessage and reply", async () => {
    const saved = message({ id: "m1", authorId: "alice", authorName: "Alice", body: "hi" });
    const ops: MeetChatOperations = {
      sendMessage: vi.fn().mockResolvedValue(saved),
      reply: vi.fn().mockResolvedValue({ ...saved, id: "m2", parentId: "m1" }),
    };
    const mesh = port();
    const wrapped = wrapMeetChatOperationsWithMesh(ops, "alice", null, mesh);

    await wrapped.sendMessage!("chat-general", "hi");
    await wrapped.reply!("m1", "hi");

    expect(mesh.sent.map((row) => row.envelope.kind)).toEqual([
      "channel-message",
      "channel-message",
    ]);
    expect(mesh.sent.map((row) => [...row.usernames])).toEqual([["bob"], ["bob"]]);
    expect(mesh.checkNow).toEqual([["bob"], ["bob"]]);
  });

  it("sends no check-now when a write fails", async () => {
    const ops: MeetChatOperations = {
      sendMessage: vi.fn().mockRejectedValue(new Error("offline")),
    };
    const mesh = port();
    const wrapped = wrapMeetChatOperationsWithMesh(ops, "alice", null, mesh);

    await expect(wrapped.sendMessage!("chat-general", "hi")).rejects.toThrow("offline");

    expect(mesh.sent).toEqual([]);
    expect(mesh.checkNow).toEqual([]);
  });
});
