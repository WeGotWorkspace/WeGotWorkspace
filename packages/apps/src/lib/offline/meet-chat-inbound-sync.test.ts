import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import {
  meetChatChannelsTable,
  meetChatMessagesTable,
} from "@/lib/offline/meet-chat/meet-chat-schema";
import {
  isChatChannelBackfilled,
  listCachedChatChannels,
  listCachedChatMessages,
  readChatChannelMessageCursor,
  readMeetChatSyncToken,
  upsertChatChannelInCache,
  writeMeetChatSyncToken,
  MEET_CHAT_CHANNELS_TOKEN_SCOPE,
} from "@/lib/offline/meet-chat-offline-store";
import {
  backfillChatChannelHistory,
  syncMeetChatInboundFromRest,
} from "@/lib/offline/meet-chat-inbound-sync";
import { markOutboxError } from "@/lib/offline/core/outbox-store";
import { enqueueChatEdit, upsertChatMessageInCache } from "@/lib/offline/meet-chat-offline-store";

vi.mock("@/lib/api/wgw/meet-chat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/wgw/meet-chat")>();
  return {
    ...actual,
    listChatChannels: vi.fn(),
    getChatChannel: vi.fn(),
    listChatChannelChanges: vi.fn(),
    listChatMessages: vi.fn(),
    listChatMessageChanges: vi.fn(),
  };
});

import {
  getChatChannel,
  listChatChannelChanges,
  listChatMessageChanges,
  listChatMessages,
  type WgwChatChannel,
  type WgwChatMessage,
} from "@/lib/api/wgw/meet-chat";

const username = "alice";

function wireChannel(id: string): WgwChatChannel {
  return {
    id,
    name: id,
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

function wireMessage(id: string, body: string, channelId = "chat-general"): WgwChatMessage {
  return {
    id,
    channelId,
    authorId: "bob",
    authorName: "Bob",
    body,
    createdAt: new Date().toISOString(),
    reactions: [],
    mentions: [],
  };
}

describe("meet-chat REST inbound sync", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await db.outbox.clear();
    await db.meta.clear();
    await meetChatChannelsTable(db).clear();
    await meetChatMessagesTable(db).clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("backfills full history with the before-cursor and primes the changes token", async () => {
    const older = [wireMessage("01A0000000AAAAAAAAAAAAAAAA", "one")];
    const newer = [
      wireMessage("01A0000000BBBBBBBBBBBBBBBB", "two"),
      wireMessage("01A0000000CCCCCCCCCCCCCCCC", "three"),
    ];
    vi.mocked(listChatMessages).mockImplementation(async (_channelId, opts) => {
      if (!opts?.before) return { list: newer, hasMore: true };
      expect(opts.before).toBe("01A0000000BBBBBBBBBBBBBBBB");
      return { list: older, hasMore: false };
    });
    vi.mocked(listChatMessageChanges).mockResolvedValue({
      oldState: "",
      newState: "state-1",
      created: [],
      updated: [],
      destroyed: [],
      hasMoreChanges: false,
    });

    await backfillChatChannelHistory(username, "chat-general");

    expect((await listCachedChatMessages(username)).map((row) => row.body)).toEqual([
      "one",
      "two",
      "three",
    ]);
    expect(await isChatChannelBackfilled(username, "chat-general")).toBe(true);
    expect(await readMeetChatSyncToken(username, "chat-general")).toBe("state-1");
    expect(await readChatChannelMessageCursor(username, "chat-general")).toBe(
      "01A0000000CCCCCCCCCCCCCCCC",
    );
  });

  it("ingests channel changes, backfills new channels, and pages created messages via since", async () => {
    // Cached, already-backfilled channel with an existing cursor + token.
    await upsertChatChannelInCache(username, wireChannel("chat-general"));
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await db.meta.put({ key: "meet-chat:backfill:chat-general", value: "done" });
    await db.meta.put({
      key: "meet-chat:cursor:chat-general",
      value: "01A0000000AAAAAAAAAAAAAAAA",
    });
    await writeMeetChatSyncToken(username, "chat-general", "msg-state-0");
    await writeMeetChatSyncToken(username, MEET_CHAT_CHANNELS_TOKEN_SCOPE, "ch-state-0");

    vi.mocked(listChatChannelChanges).mockResolvedValue({
      oldState: "ch-state-0",
      newState: "ch-state-1",
      created: [],
      updated: ["chat-general"],
      destroyed: [],
    });
    vi.mocked(getChatChannel).mockResolvedValue({
      ...wireChannel("chat-general"),
      topic: "fresh topic",
    });
    vi.mocked(listChatMessageChanges).mockResolvedValue({
      oldState: "msg-state-0",
      newState: "msg-state-1",
      created: ["01A0000000DDDDDDDDDDDDDDDD"],
      updated: [],
      destroyed: [],
      hasMoreChanges: false,
    });
    vi.mocked(listChatMessages).mockImplementation(async (_channelId, opts) => {
      expect(opts?.since).toBe("01A0000000AAAAAAAAAAAAAAAA");
      return { list: [wireMessage("01A0000000DDDDDDDDDDDDDDDD", "new msg")], hasMore: false };
    });

    const result = await syncMeetChatInboundFromRest(username);

    expect(result.changed).toBe(true);
    expect(result.usedFullResync).toBe(false);
    expect((await listCachedChatChannels(username))[0]?.topic).toBe("fresh topic");
    expect((await listCachedChatMessages(username)).map((row) => row.body)).toEqual(["new msg"]);
    expect(await readMeetChatSyncToken(username, "chat-general")).toBe("msg-state-1");
    expect(await readMeetChatSyncToken(username, MEET_CHAT_CHANNELS_TOKEN_SCOPE)).toBe(
      "ch-state-1",
    );
  });

  it("re-lists the channel when old messages were updated or destroyed", async () => {
    await upsertChatChannelInCache(username, wireChannel("chat-general"));
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await db.meta.put({ key: "meet-chat:backfill:chat-general", value: "done" });
    await writeMeetChatSyncToken(username, "chat-general", "msg-state-0");
    await writeMeetChatSyncToken(username, MEET_CHAT_CHANNELS_TOKEN_SCOPE, "ch-state-0");

    vi.mocked(listChatChannelChanges).mockResolvedValue({
      oldState: "ch-state-0",
      newState: "ch-state-0",
      created: [],
      updated: [],
      destroyed: [],
    });
    vi.mocked(listChatMessageChanges).mockResolvedValue({
      oldState: "msg-state-0",
      newState: "msg-state-1",
      created: [],
      updated: ["01A0000000EEEEEEEEEEEEEEEE"],
      destroyed: [],
      hasMoreChanges: false,
    });
    const edited = {
      ...wireMessage("01A0000000EEEEEEEEEEEEEEEE", "edited body"),
      editedAt: new Date().toISOString(),
    };
    vi.mocked(listChatMessages).mockResolvedValue({ list: [edited], hasMore: false });

    const result = await syncMeetChatInboundFromRest(username);

    expect(result.changed).toBe(true);
    const messages = await listCachedChatMessages(username);
    expect(messages.map((row) => row.body)).toEqual(["edited body"]);
    expect(messages[0]?.editedAt).toBeTruthy();
  });

  /** A cached, backfilled channel with a messages token and a cursor. */
  async function syncedChannel(id: string, cursor = "01A0000000AAAAAAAAAAAAAAAA") {
    await upsertChatChannelInCache(username, wireChannel(id));
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await db.meta.put({ key: `meet-chat:backfill:${id}`, value: "done" });
    await db.meta.put({ key: `meet-chat:cursor:${id}`, value: cursor });
    await writeMeetChatSyncToken(username, id, `${id}-state-0`);
  }

  function noChannelChanges() {
    vi.mocked(listChatChannelChanges).mockResolvedValue({
      oldState: "ch-state-0",
      newState: "ch-state-0",
      created: [],
      updated: [],
      destroyed: [],
    });
  }

  const messageChanges = (
    channelId: string,
    delta: { created?: string[]; updated?: string[]; destroyed?: string[] },
  ) => ({
    oldState: `${channelId}-state-0`,
    newState: `${channelId}-state-1`,
    created: delta.created ?? [],
    updated: delta.updated ?? [],
    destroyed: delta.destroyed ?? [],
    hasMoreChanges: false,
  });

  it("keeps pulling the other channels when one channel fails, then reports the failure", async () => {
    await syncedChannel("chat-a");
    await syncedChannel("chat-b");
    await writeMeetChatSyncToken(username, MEET_CHAT_CHANNELS_TOKEN_SCOPE, "ch-state-0");
    noChannelChanges();
    vi.mocked(listChatMessageChanges).mockImplementation(async (channelId) => {
      if (channelId === "chat-a") throw new Error("server error");
      return messageChanges(channelId, { created: ["01A0000000DDDDDDDDDDDDDDDD"] });
    });
    vi.mocked(listChatMessages).mockResolvedValue({
      list: [wireMessage("01A0000000DDDDDDDDDDDDDDDD", "from b", "chat-b")],
      hasMore: false,
    });

    await expect(syncMeetChatInboundFromRest(username)).rejects.toThrow("server error");

    expect((await listCachedChatMessages(username)).map((row) => row.body)).toEqual(["from b"]);
    expect(await readMeetChatSyncToken(username, "chat-a")).toBe("chat-a-state-0");
    expect(await readMeetChatSyncToken(username, "chat-b")).toBe("chat-b-state-1");
  });

  it("re-lists the channel for a new message the since-cursor cannot reach", async () => {
    // A peer's offline message keeps the ULID it got offline: older than the cursor.
    await syncedChannel("chat-general", "01A0000000CCCCCCCCCCCCCCCC");
    await writeMeetChatSyncToken(username, MEET_CHAT_CHANNELS_TOKEN_SCOPE, "ch-state-0");
    noChannelChanges();
    vi.mocked(listChatMessageChanges).mockResolvedValue(
      messageChanges("chat-general", { created: ["01A0000000BBBBBBBBBBBBBBBB"] }),
    );
    vi.mocked(listChatMessages).mockImplementation(async (_channelId, opts) => {
      if (opts?.since) return { list: [], hasMore: false };
      return { list: [wireMessage("01A0000000BBBBBBBBBBBBBBBB", "sent offline")], hasMore: false };
    });

    await syncMeetChatInboundFromRest(username);

    expect((await listCachedChatMessages(username)).map((row) => row.body)).toEqual([
      "sent offline",
    ]);
    // The cursor never moves back.
    expect(await readChatChannelMessageCursor(username, "chat-general")).toBe(
      "01A0000000CCCCCCCCCCCCCCCC",
    );
  });

  it("removes a message destroyed elsewhere without re-listing the channel", async () => {
    await syncedChannel("chat-general");
    await writeMeetChatSyncToken(username, MEET_CHAT_CHANNELS_TOKEN_SCOPE, "ch-state-0");
    await upsertChatMessageInCache(username, {
      ...chatMessage("01A0000000AAAAAAAAAAAAAAAA", "doomed"),
    });
    noChannelChanges();
    vi.mocked(listChatMessageChanges).mockResolvedValue(
      messageChanges("chat-general", { destroyed: ["01A0000000AAAAAAAAAAAAAAAA"] }),
    );

    const result = await syncMeetChatInboundFromRest(username);

    expect(result.changed).toBe(true);
    expect(listChatMessages).not.toHaveBeenCalled();
    expect(await listCachedChatMessages(username)).toEqual([]);
  });

  it("holds the channel token while a queued edit skips the server's change", async () => {
    await syncedChannel("chat-general");
    await writeMeetChatSyncToken(username, MEET_CHAT_CHANNELS_TOKEN_SCOPE, "ch-state-0");
    const id = "01A0000000AAAAAAAAAAAAAAAA";
    await upsertChatMessageInCache(username, chatMessage(id, "mine, edited offline"));
    await enqueueChatEdit(username, { messageId: id, body: "mine, edited offline" });
    noChannelChanges();
    vi.mocked(listChatMessageChanges).mockResolvedValue(
      messageChanges("chat-general", { updated: [id] }),
    );
    vi.mocked(listChatMessages).mockResolvedValue({
      list: [wireMessage(id, "server copy")],
      hasMore: false,
    });

    await syncMeetChatInboundFromRest(username);

    expect((await listCachedChatMessages(username))[0]?.body).toBe("mine, edited offline");
    expect(await readMeetChatSyncToken(username, "chat-general")).toBe("chat-general-state-0");
  });

  it("does not hold the token for a queued write the server refused for good", async () => {
    await syncedChannel("chat-general");
    await writeMeetChatSyncToken(username, MEET_CHAT_CHANNELS_TOKEN_SCOPE, "ch-state-0");
    const id = "01A0000000AAAAAAAAAAAAAAAA";
    await upsertChatMessageInCache(username, chatMessage(id, "mine, edited offline"));
    await enqueueChatEdit(username, { messageId: id, body: "mine, edited offline" });
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    const [row] = await db.outbox.toArray();
    await markOutboxError(username, row!.id, "forbidden", 403);
    noChannelChanges();
    vi.mocked(listChatMessageChanges).mockResolvedValue(
      messageChanges("chat-general", { updated: [id] }),
    );
    vi.mocked(listChatMessages).mockResolvedValue({
      list: [wireMessage(id, "server copy")],
      hasMore: false,
    });

    await syncMeetChatInboundFromRest(username);

    expect((await listCachedChatMessages(username))[0]?.body).toBe("mine, edited offline");
    expect(await readMeetChatSyncToken(username, "chat-general")).toBe("chat-general-state-1");
  });
});

function chatMessage(id: string, body: string) {
  return {
    id,
    channelId: "chat-general",
    authorId: "alice",
    authorName: "Alice",
    body,
    createdAt: Date.now(),
    reactions: [],
    mentions: [],
    previews: [],
  };
}
