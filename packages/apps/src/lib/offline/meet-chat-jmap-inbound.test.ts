import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import type { ChatMessage } from "@/meet-core/src/meet-types";
import type { WgwChatChannel } from "@/lib/api/wgw/meet-chat";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import {
  meetChatChannelsTable,
  meetChatMessagesTable,
} from "@/lib/offline/meet-chat/meet-chat-schema";
import {
  ingestRemoteChatChannel,
  ingestRemoteChatChannelDestroyed,
  ingestRemoteChatMessage,
  ingestRemoteChatMessageDestroyed,
  reconcileMeetChatSnapshot,
} from "@/lib/offline/meet-chat-jmap-inbound";
import {
  enqueueChatEdit,
  getCachedChatMessage,
  listCachedChatChannels,
  listCachedChatMessages,
  upsertChatMessageInCache,
} from "@/lib/offline/meet-chat-offline-store";

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

function appMessage(id: string, channelId: string, body: string): ChatMessage {
  return {
    id,
    channelId,
    authorId: "bob",
    authorName: "Bob",
    body,
    createdAt: Date.now(),
    reactions: [],
    mentions: [],
    previews: [],
    parentId: null,
    threadId: null,
  };
}

describe("meet-chat JMAP inbound ingest", () => {
  beforeEach(async () => {
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await db.outbox.clear();
    await db.meta.clear();
    await meetChatChannelsTable(db).clear();
    await meetChatMessagesTable(db).clear();
  });

  it("upserts remote messages and channels", async () => {
    await ingestRemoteChatChannel(username, wireChannel("chat-general"));
    const result = await ingestRemoteChatMessage(
      username,
      appMessage("01ARZ3NDEKTSV4RRFFQ69G5FAA", "chat-general", "hello"),
    );
    expect(result).toBe("upserted");
    expect((await listCachedChatChannels(username)).map((row) => row.id)).toEqual(["chat-general"]);
    expect((await listCachedChatMessages(username)).map((row) => row.body)).toEqual(["hello"]);
  });

  it("skips rows owned by a pending local write", async () => {
    const pending = appMessage("01ARZ3NDEKTSV4RRFFQ69G5FAB", "chat-general", "local body");
    await upsertChatMessageInCache(username, pending, true);

    const remote = { ...pending, body: "remote body" };
    expect(await ingestRemoteChatMessage(username, remote)).toBe("skipped-pending");
    expect((await getCachedChatMessage(username, pending.id))?.body).toBe("local body");

    expect(await ingestRemoteChatMessageDestroyed(username, pending.id)).toBe("skipped-pending");
    expect(await getCachedChatMessage(username, pending.id)).toBeDefined();
  });

  it("skips rows referenced by a queued outbox mutation even when not pendingSync", async () => {
    const synced = appMessage("01ARZ3NDEKTSV4RRFFQ69G5FAC", "chat-general", "synced body");
    await upsertChatMessageInCache(username, synced, false);
    await enqueueChatEdit(username, { messageId: synced.id, body: "queued edit" });

    const remote = { ...synced, body: "remote body" };
    expect(await ingestRemoteChatMessage(username, remote)).toBe("skipped-pending");
    expect((await getCachedChatMessage(username, synced.id))?.body).toBe("synced body");
  });

  it("removes remotely destroyed messages and channels", async () => {
    await ingestRemoteChatChannel(username, wireChannel("chat-old"));
    const message = appMessage("01ARZ3NDEKTSV4RRFFQ69G5FAD", "chat-old", "bye");
    await upsertChatMessageInCache(username, message, false);

    expect(await ingestRemoteChatMessageDestroyed(username, message.id)).toBe("removed");
    expect(await getCachedChatMessage(username, message.id)).toBeUndefined();

    await upsertChatMessageInCache(username, message, false);
    await ingestRemoteChatChannelDestroyed(username, "chat-old");
    expect(await listCachedChatChannels(username)).toEqual([]);
    // Channel removal cascades its cached messages.
    expect(await getCachedChatMessage(username, message.id)).toBeUndefined();
  });

  it("reconciles a full snapshot, keeping pending local writes", async () => {
    await ingestRemoteChatChannel(username, wireChannel("chat-keep"));
    await ingestRemoteChatChannel(username, wireChannel("chat-gone"));
    const keep = appMessage("01ARZ3NDEKTSV4RRFFQ69G5FAE", "chat-keep", "keep");
    const gone = appMessage("01ARZ3NDEKTSV4RRFFQ69G5FAF", "chat-keep", "gone");
    const pending = appMessage("01ARZ3NDEKTSV4RRFFQ69G5FAG", "chat-keep", "pending");
    await upsertChatMessageInCache(username, keep, false);
    await upsertChatMessageInCache(username, gone, false);
    await upsertChatMessageInCache(username, pending, true);

    await reconcileMeetChatSnapshot(username, [wireChannel("chat-keep")], [keep]);

    expect((await listCachedChatChannels(username)).map((row) => row.id)).toEqual(["chat-keep"]);
    const ids = (await listCachedChatMessages(username)).map((row) => row.id);
    expect(ids).toContain(keep.id);
    expect(ids).toContain(pending.id);
    expect(ids).not.toContain(gone.id);
  });
});
