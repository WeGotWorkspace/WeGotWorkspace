import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@/meet-core/src/meet-types";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import {
  meetChatChannelsTable,
  meetChatMessagesTable,
} from "@/lib/offline/meet-chat/meet-chat-schema";
import { isChatMessageUlid } from "@/lib/offline/meet-chat/chat-ulid";
import {
  getCachedChatMessage,
  listCachedChatMessages,
  listMeetChatOutbox,
  listPendingChatMessageIds,
  upsertChatChannelInCache,
  upsertChatMessageInCache,
  type MeetChatSendOutboxPayload,
} from "@/lib/offline/meet-chat-offline-store";
import { createHybridMeetChatOperations } from "@/lib/offline/meet-chat-hybrid-operations";

const username = "alice";
const author = { id: "alice", displayName: "Alice" };

vi.mock("@/lib/offline/core/browser-online", () => ({
  readBrowserOnline: vi.fn(() => true),
  getConnectivitySnapshot: vi.fn(() => true),
  subscribeBrowserOnline: vi.fn(() => () => undefined),
  isFetchNetworkError: vi.fn((error: unknown) => {
    if (error instanceof TypeError) {
      return error.message.toLowerCase().includes("network");
    }
    return false;
  }),
}));

vi.mock("@/lib/api/wgw/meet-chat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/wgw/meet-chat")>();
  return {
    ...actual,
    sendChatMessage: vi.fn(),
    patchChatMessage: vi.fn(),
    deleteChatMessage: vi.fn(),
    toggleChatReaction: vi.fn(),
    createChatChannel: vi.fn(),
    patchChatChannel: vi.fn(),
    putChatReadMarker: vi.fn(),
    openChatDm: vi.fn(),
  };
});

vi.mock("@/lib/api/wgw/calendar", () => ({
  searchCollectionSharePrincipals: vi.fn(async () => [
    { id: "bob", displayName: "Bob", principalType: "user" },
  ]),
}));

import {
  MeetChatRequestError,
  openChatDm,
  patchChatChannel,
  patchChatMessage,
  sendChatMessage,
  toggleChatReaction,
  type WgwChatChannel,
  type WgwChatMessage,
} from "@/lib/api/wgw/meet-chat";
import { searchCollectionSharePrincipals } from "@/lib/api/wgw/calendar";
import { readBrowserOnline } from "@/lib/offline/core/browser-online";

function wireMessage(
  overrides: Partial<WgwChatMessage> & Pick<WgwChatMessage, "id">,
): WgwChatMessage {
  return {
    channelId: "chat-general",
    authorId: author.id,
    authorName: author.displayName,
    body: "hello",
    createdAt: new Date().toISOString(),
    reactions: [],
    mentions: [],
    ...overrides,
  };
}

function cachedMessage(id: string, body = "cached", channelId = "chat-general"): ChatMessage {
  return {
    id,
    channelId,
    authorId: author.id,
    authorName: author.displayName,
    body,
    createdAt: Date.now(),
    reactions: [],
    mentions: [],
    previews: [],
    parentId: null,
    threadId: null,
  };
}

describe("createHybridMeetChatOperations", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(readBrowserOnline).mockReturnValue(true);
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await db.outbox.clear();
    await db.meta.clear();
    await meetChatChannelsTable(db).clear();
    await meetChatMessagesTable(db).clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends online with a client ULID and caches the saved message", async () => {
    vi.mocked(sendChatMessage).mockImplementation(async (_channelId, body) =>
      wireMessage({ id: body.id, body: body.body }),
    );

    const operations = createHybridMeetChatOperations(username, author);
    const saved = await operations.sendMessage!("chat-general", "hello world");

    expect(isChatMessageUlid(saved.id)).toBe(true);
    expect(sendChatMessage).toHaveBeenCalledWith(
      "chat-general",
      expect.objectContaining({ id: saved.id, body: "hello world" }),
    );
    expect(await listPendingChatMessageIds(username)).toEqual([]);
    expect((await getCachedChatMessage(username, saved.id))?.body).toBe("hello world");
    expect(await listMeetChatOutbox(username)).toHaveLength(0);
  });

  it("queues sends offline as pending Dexie rows plus a send outbox op", async () => {
    vi.mocked(readBrowserOnline).mockReturnValue(false);

    const operations = createHybridMeetChatOperations(username, author);
    const optimistic = await operations.sendMessage!("chat-general", "offline hello");

    expect(isChatMessageUlid(optimistic.id)).toBe(true);
    expect(sendChatMessage).not.toHaveBeenCalled();
    expect(await listPendingChatMessageIds(username)).toEqual([optimistic.id]);

    const outbox = await listMeetChatOutbox(username);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.op).toBe("send");
    const payload = JSON.parse(outbox[0]!.payload) as MeetChatSendOutboxPayload;
    expect(payload).toEqual({
      messageId: optimistic.id,
      channelId: "chat-general",
      body: "offline hello",
      parentId: null,
    });
  });

  it("queues sends when the live API fails with a network error", async () => {
    vi.mocked(sendChatMessage).mockRejectedValue(new TypeError("network request failed"));

    const operations = createHybridMeetChatOperations(username, author);
    const optimistic = await operations.sendMessage!("chat-general", "queued after error");

    expect(sendChatMessage).toHaveBeenCalledOnce();
    expect(await listPendingChatMessageIds(username)).toEqual([optimistic.id]);
    expect((await listMeetChatOutbox(username)).map((row) => row.op)).toEqual(["send"]);
  });

  it("throws instead of queueing on auth errors", async () => {
    vi.mocked(sendChatMessage).mockRejectedValue(new MeetChatRequestError("forbidden", 403));

    const operations = createHybridMeetChatOperations(username, author);
    await expect(operations.sendMessage!("chat-general", "nope")).rejects.toMatchObject({
      status: 403,
    });
    expect(await listMeetChatOutbox(username)).toHaveLength(0);
  });

  it("merges an offline edit into the queued send for the same ULID", async () => {
    vi.mocked(readBrowserOnline).mockReturnValue(false);

    const operations = createHybridMeetChatOperations(username, author);
    const optimistic = await operations.sendMessage!("chat-general", "first draft");
    const edited = await operations.editMessage!(optimistic.id, "second draft");

    expect(edited.body).toBe("second draft");
    const outbox = await listMeetChatOutbox(username);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.op).toBe("send");
    expect((JSON.parse(outbox[0]!.payload) as MeetChatSendOutboxPayload).body).toBe("second draft");
  });

  it("cancels a queued send entirely when the message is deleted offline", async () => {
    vi.mocked(readBrowserOnline).mockReturnValue(false);

    const operations = createHybridMeetChatOperations(username, author);
    const optimistic = await operations.sendMessage!("chat-general", "never sent");
    await operations.deleteMessage!(optimistic.id);

    expect(await listMeetChatOutbox(username)).toHaveLength(0);
    expect(await getCachedChatMessage(username, optimistic.id)).toBeUndefined();
  });

  it("tombstones a synced message offline and queues the delete", async () => {
    vi.mocked(readBrowserOnline).mockReturnValue(false);
    const synced = cachedMessage("01ARZ3NDEKTSV4RRFFQ69G5FAV");
    await upsertChatMessageInCache(username, synced, false);

    const operations = createHybridMeetChatOperations(username, author);
    await operations.deleteMessage!(synced.id);

    const row = await getCachedChatMessage(username, synced.id);
    expect(row?.deletedAt).toBeTruthy();
    expect(row?.body).toBe("");
    expect((await listMeetChatOutbox(username)).map((r) => r.op)).toEqual(["delete"]);
  });

  it("toggles reactions offline with pair-cancel coalescing", async () => {
    vi.mocked(readBrowserOnline).mockReturnValue(false);
    const synced = cachedMessage("01ARZ3NDEKTSV4RRFFQ69G5FAW");
    await upsertChatMessageInCache(username, synced, false);

    const operations = createHybridMeetChatOperations(username, author);
    const once = await operations.react!(synced.id, "👍");
    expect(once.reactions).toEqual([{ emoji: "👍", authors: [author.id] }]);
    expect(await listMeetChatOutbox(username)).toHaveLength(1);

    const twice = await operations.react!(synced.id, "👍");
    expect(twice.reactions).toEqual([]);
    // Toggle + untoggle is a net zero — nothing left to replay.
    expect(await listMeetChatOutbox(username)).toHaveLength(0);
  });

  it("queues reactions on 5xx and returns the optimistic toggle", async () => {
    vi.mocked(toggleChatReaction).mockRejectedValue(new MeetChatRequestError("oops", 503));
    const synced = cachedMessage("01ARZ3NDEKTSV4RRFFQ69G5FAX");
    await upsertChatMessageInCache(username, synced, false);

    const operations = createHybridMeetChatOperations(username, author);
    const optimistic = await operations.react!(synced.id, "🎉");

    expect(optimistic.reactions).toEqual([{ emoji: "🎉", authors: [author.id] }]);
    expect((await listMeetChatOutbox(username)).map((r) => r.op)).toEqual(["react"]);
  });

  it("replies against the thread root and bumps the parent replyCount", async () => {
    const parent = cachedMessage("01ARZ3NDEKTSV4RRFFQ69G5FAY", "root");
    await upsertChatMessageInCache(username, parent, false);
    vi.mocked(sendChatMessage).mockImplementation(async (_channelId, body) =>
      wireMessage({ id: body.id, body: body.body, parentId: body.parentId ?? null }),
    );

    const operations = createHybridMeetChatOperations(username, author);
    const reply = await operations.reply!(parent.id, "a reply");

    expect(reply.parentId).toBe(parent.id);
    expect(reply.threadId).toBe(parent.id);
    expect((await getCachedChatMessage(username, parent.id))?.replyCount).toBe(1);
  });

  it("passes channel shareWith through with full wire rights and updates the cache", async () => {
    const updated: WgwChatChannel = {
      id: "chat-general",
      name: "General",
      kind: "channel",
      scope: "personal",
      groupSlug: null,
      isSharee: false,
      shareWith: {
        bob: { mayRead: true, mayWrite: true, mayShare: false, mayDelete: false },
      },
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
    vi.mocked(patchChatChannel).mockResolvedValue(updated);

    const operations = createHybridMeetChatOperations(username, author);
    const channel = await operations.patchChannelShareWith!("chat-general", {
      bob: { mayRead: true, mayWrite: true },
    });

    expect(patchChatChannel).toHaveBeenCalledWith("chat-general", {
      shareWith: { bob: { mayRead: true, mayWrite: true, mayShare: false, mayDelete: false } },
    });
    expect(channel.shareWith).toEqual(updated.shareWith);

    vi.mocked(readBrowserOnline).mockReturnValue(false);
    await expect(
      operations.patchChannelShareWith!("chat-general", { carol: { mayRead: true } }),
    ).rejects.toThrow(/connection/i);
  });

  it("delegates searchSharePrincipals to the shared live principal search", async () => {
    const operations = createHybridMeetChatOperations(username, author);
    const principals = await operations.searchSharePrincipals!("bo");
    expect(searchCollectionSharePrincipals).toHaveBeenCalledWith("bo", username);
    expect(principals.map((row) => row.id)).toEqual(["bob"]);
  });

  describe("direct messages (chunk G)", () => {
    const dmChannel: WgwChatChannel = {
      id: "dm-0123456789abcdef0123456789abcdef01234567",
      name: "Bob",
      kind: "dm",
      scope: "personal",
      groupSlug: null,
      isSharee: false,
      shareWith: null,
      dmPeer: "bob",
      unreadCount: 0,
      myRights: {
        mayReadItems: true,
        mayWriteAll: true,
        mayWriteOwn: true,
        mayUpdatePrivate: true,
        mayRSVP: true,
        mayAdmin: false,
        mayDelete: true,
        mayShare: false,
      },
    } as WgwChatChannel;

    it("openDm returns the cached dm channel without a REST call", async () => {
      await upsertChatChannelInCache(username, dmChannel);

      const operations = createHybridMeetChatOperations(username, author);
      const channel = await operations.openDm!("bob");

      expect(channel.id).toBe(dmChannel.id);
      expect(openChatDm).not.toHaveBeenCalled();
    });

    it("openDm provisions via POST /chat/dms on a cache miss and caches the row", async () => {
      vi.mocked(openChatDm).mockResolvedValue(dmChannel);

      const operations = createHybridMeetChatOperations(username, author);
      const channel = await operations.openDm!("bob");

      expect(openChatDm).toHaveBeenCalledWith("bob");
      expect(channel.id).toBe(dmChannel.id);

      // Cached: the second open (and later sends/calls) skip the network.
      vi.mocked(openChatDm).mockClear();
      await operations.openDm!("bob");
      expect(openChatDm).not.toHaveBeenCalled();
    });

    it("sends to a virtual dm:{peer} id by provisioning and re-keys the saved message", async () => {
      vi.mocked(openChatDm).mockResolvedValue(dmChannel);
      vi.mocked(sendChatMessage).mockImplementation(async (channelId, body) =>
        wireMessage({ id: body.id, body: body.body, channelId }),
      );

      const operations = createHybridMeetChatOperations(username, author);
      const saved = await operations.sendMessage!("dm:bob", "hi bob");

      expect(openChatDm).toHaveBeenCalledWith("bob");
      expect(sendChatMessage).toHaveBeenCalledWith(
        dmChannel.id,
        expect.objectContaining({ body: "hi bob" }),
      );
      // The UI keeps addressing the conversation by the virtual DM-rail id.
      expect(saved.channelId).toBe("dm:bob");
      expect((await getCachedChatMessage(username, saved.id))?.channelId).toBe("dm:bob");
    });

    it("queues offline dm sends under the virtual id for the flush to resolve", async () => {
      vi.mocked(readBrowserOnline).mockReturnValue(false);

      const operations = createHybridMeetChatOperations(username, author);
      const optimistic = await operations.sendMessage!("dm:bob", "offline dm");

      expect(optimistic.channelId).toBe("dm:bob");
      expect(openChatDm).not.toHaveBeenCalled();
      const outbox = await listMeetChatOutbox(username);
      expect(outbox).toHaveLength(1);
      const payload = JSON.parse(outbox[0]!.payload) as MeetChatSendOutboxPayload;
      expect(payload.channelId).toBe("dm:bob");
    });

    it("re-keys dm edit/react responses onto the virtual channel id", async () => {
      await upsertChatChannelInCache(username, dmChannel);
      const cached = cachedMessage("01ARZ3NDEKTSV4RRFFQ69G5FC0", "dm body", "dm:bob");
      await upsertChatMessageInCache(username, cached, false);
      vi.mocked(patchChatMessage).mockResolvedValue(
        wireMessage({ id: cached.id, body: "dm body!", channelId: dmChannel.id }),
      );

      const operations = createHybridMeetChatOperations(username, author);
      const edited = await operations.editMessage!(cached.id, "dm body!");

      expect(edited.channelId).toBe("dm:bob");
      expect((await getCachedChatMessage(username, cached.id))?.channelId).toBe("dm:bob");
    });
  });

  it("orders cached messages by (createdAt, ULID)", async () => {
    const early = { ...cachedMessage("01ARZ3NDEKTSV4RRFFQ69G5FB2", "b"), createdAt: 1000 };
    const earlySameTs = { ...cachedMessage("01ARZ3NDEKTSV4RRFFQ69G5FB1", "a"), createdAt: 1000 };
    const late = { ...cachedMessage("01ARZ3NDEKTSV4RRFFQ69G5FB0", "c"), createdAt: 2000 };
    await upsertChatMessageInCache(username, early, false);
    await upsertChatMessageInCache(username, late, false);
    await upsertChatMessageInCache(username, earlySameTs, false);

    const ordered = await listCachedChatMessages(username);
    expect(ordered.map((row) => row.body)).toEqual(["a", "b", "c"]);
  });
});
