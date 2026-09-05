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

function wireMessage(id: string, body: string): WgwChatMessage {
  return {
    id,
    channelId: "chat-general",
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
});
