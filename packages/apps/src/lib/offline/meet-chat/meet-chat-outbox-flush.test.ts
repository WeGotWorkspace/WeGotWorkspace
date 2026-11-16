import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@/lib/models/meet-types";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import {
  meetChatChannelsTable,
  meetChatMessagesTable,
} from "@/lib/offline/meet-chat/meet-chat-schema";
import {
  enqueueChatDelete,
  enqueueChatEdit,
  enqueueChatReactionToggle,
  enqueueChatReadMarker,
  enqueueChatSend,
  getCachedChatMessage,
  listMeetChatOutbox,
  listPendingChatMessageIds,
  upsertChatMessageInCache,
} from "@/lib/offline/meet-chat/meet-chat-offline-store";
import { flushMeetChatOutbox } from "@/lib/offline/meet-chat/meet-chat-outbox-flush";

vi.mock("@/lib/api/wgw/meet-chat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/wgw/meet-chat")>();
  return {
    ...actual,
    sendChatMessage: vi.fn(),
    patchChatMessage: vi.fn(),
    deleteChatMessage: vi.fn(),
    toggleChatReaction: vi.fn(),
    putChatReadMarker: vi.fn(),
    openChatDm: vi.fn(),
  };
});

import {
  deleteChatMessage,
  MeetChatRequestError,
  openChatDm,
  patchChatMessage,
  putChatReadMarker,
  sendChatMessage,
  toggleChatReaction,
  type WgwChatChannel,
  type WgwChatMessage,
} from "@/lib/api/wgw/meet-chat";

const username = "alice";
const ULID_A = "01ARZ3NDEKTSV4RRFFQ69G5FA0";
const ULID_B = "01ARZ3NDEKTSV4RRFFQ69G5FA1";

function wireMessage(id: string, body: string): WgwChatMessage {
  return {
    id,
    channelId: "chat-general",
    authorId: "alice",
    authorName: "Alice",
    body,
    createdAt: new Date().toISOString(),
    reactions: [],
    mentions: [],
  };
}

function pendingMessage(id: string, body: string): ChatMessage {
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
    parentId: null,
    threadId: null,
  };
}

describe("flushMeetChatOutbox", () => {
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

  it("replays queued ops oldest-first and clears pendingSync", async () => {
    await upsertChatMessageInCache(username, pendingMessage(ULID_A, "queued send"), true);
    await enqueueChatSend(username, {
      messageId: ULID_A,
      channelId: "chat-general",
      body: "queued send",
      parentId: null,
    });
    await upsertChatMessageInCache(username, pendingMessage(ULID_B, "existing"), true);
    await enqueueChatReactionToggle(username, { messageId: ULID_B, emoji: "👍" });
    await enqueueChatReadMarker(username, {
      channelId: "chat-general",
      lastReadTs: new Date().toISOString(),
      lastReadUid: ULID_B,
    });

    const calls: string[] = [];
    vi.mocked(sendChatMessage).mockImplementation(async (_channelId, body) => {
      calls.push("send");
      return wireMessage(body.id, body.body);
    });
    vi.mocked(toggleChatReaction).mockImplementation(async (messageId, emoji) => {
      calls.push("react");
      return { ...wireMessage(messageId, "existing"), reactions: [{ emoji, authors: ["alice"] }] };
    });
    vi.mocked(putChatReadMarker).mockImplementation(async () => {
      calls.push("readMarker");
    });

    const result = await flushMeetChatOutbox(username);

    expect(result).toEqual({ flushed: 3, failed: 0 });
    expect(calls).toEqual(["send", "react", "readMarker"]);
    expect(await listMeetChatOutbox(username)).toHaveLength(0);
    expect(await listPendingChatMessageIds(username)).toEqual([]);
    expect((await getCachedChatMessage(username, ULID_B))?.reactions).toEqual([
      { emoji: "👍", authors: ["alice"] },
    ]);
  });

  it("re-keys a sent message when the server answers with another id", async () => {
    await upsertChatMessageInCache(username, pendingMessage(ULID_A, "taken id"), true);
    await enqueueChatSend(username, {
      messageId: ULID_A,
      channelId: "chat-general",
      body: "taken id",
      parentId: null,
    });
    vi.mocked(sendChatMessage).mockImplementation(async (_channelId, body) =>
      wireMessage(ULID_B, body.body),
    );

    await flushMeetChatOutbox(username);

    expect(await getCachedChatMessage(username, ULID_A)).toBeUndefined();
    expect((await getCachedChatMessage(username, ULID_B))?.body).toBe("taken id");
    expect(await listPendingChatMessageIds(username)).toEqual([]);
  });

  it("sends a reaction queued behind a re-keyed send to the new id", async () => {
    await upsertChatMessageInCache(username, pendingMessage(ULID_A, "taken id"), true);
    await enqueueChatSend(username, {
      messageId: ULID_A,
      channelId: "chat-general",
      body: "taken id",
      parentId: null,
    });
    await enqueueChatReactionToggle(username, { messageId: ULID_A, emoji: "👍" });
    vi.mocked(sendChatMessage).mockImplementation(async (_channelId, body) =>
      wireMessage(ULID_B, body.body),
    );
    vi.mocked(toggleChatReaction).mockImplementation(async (id) => wireMessage(id, "taken id"));

    await flushMeetChatOutbox(username);

    expect(toggleChatReaction).toHaveBeenCalledWith(ULID_B, "👍");
    expect(await listMeetChatOutbox(username)).toEqual([]);
  });

  it("keeps failed rows queued with the error recorded and retries the same ULID", async () => {
    await upsertChatMessageInCache(username, pendingMessage(ULID_A, "retry me"), true);
    await enqueueChatSend(username, {
      messageId: ULID_A,
      channelId: "chat-general",
      body: "retry me",
      parentId: null,
    });

    vi.mocked(sendChatMessage).mockRejectedValueOnce(new TypeError("network request failed"));
    const first = await flushMeetChatOutbox(username);
    expect(first.flushed).toBe(0);
    expect(first.failed).toBe(1);

    const queued = await listMeetChatOutbox(username);
    expect(queued).toHaveLength(1);
    expect(queued[0]?.retries).toBe(1);
    expect(queued[0]?.lastError).toMatch(/network/i);

    vi.mocked(sendChatMessage).mockImplementation(async (_channelId, body) =>
      wireMessage(body.id, body.body),
    );
    const second = await flushMeetChatOutbox(username);
    expect(second.flushed).toBe(1);
    // Idempotent retry reuses the exact same client ULID.
    expect(vi.mocked(sendChatMessage).mock.calls.every(([, body]) => body.id === ULID_A)).toBe(
      true,
    );
    expect(await listPendingChatMessageIds(username)).toEqual([]);
  });

  it("records a refused send with its status and an unreadable row, and still sends the rows after them", async () => {
    await enqueueChatSend(username, {
      messageId: ULID_A,
      channelId: "chat-general",
      body: "refused",
      parentId: null,
    });
    await enqueueChatEdit(username, { messageId: ULID_B, body: "unreadable" });
    await enqueueChatReadMarker(username, {
      channelId: "chat-general",
      lastReadTs: "2026-01-01T00:00:00.000Z",
      lastReadUid: ULID_B,
    });
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    const [, edit] = await listMeetChatOutbox(username);
    await db.outbox.update(edit!.id, { payload: "{not json" });
    vi.mocked(sendChatMessage).mockRejectedValue(new MeetChatRequestError("read-only", 403));

    const result = await flushMeetChatOutbox(username);

    expect(result).toEqual({ flushed: 1, failed: 2 });
    expect(putChatReadMarker).toHaveBeenCalledTimes(1);
    const queued = await listMeetChatOutbox(username);
    expect(queued.map((row) => [row.op, row.lastStatus, row.retries])).toEqual([
      ["send", 403, 1],
      ["edit", undefined, 1],
    ]);
  });

  it("treats delete 404 as success (tombstone already gone)", async () => {
    await enqueueChatDelete(username, { messageId: ULID_A });
    vi.mocked(deleteChatMessage).mockRejectedValue(new MeetChatRequestError("gone", 404));

    const result = await flushMeetChatOutbox(username);

    expect(result.flushed).toBe(1);
    expect(await listMeetChatOutbox(username)).toHaveLength(0);
  });

  it("drops local state when an edit hits a remotely deleted message", async () => {
    await upsertChatMessageInCache(username, pendingMessage(ULID_A, "stale edit"), true);
    await enqueueChatEdit(username, { messageId: ULID_A, body: "stale edit" });
    vi.mocked(patchChatMessage).mockRejectedValue(new MeetChatRequestError("gone", 404));

    const result = await flushMeetChatOutbox(username);

    expect(result.flushed).toBe(1);
    expect(await getCachedChatMessage(username, ULID_A)).toBeUndefined();
    expect(await listMeetChatOutbox(username)).toHaveLength(0);
  });

  it("resolves virtual dm:{peer} sends by provisioning and re-keys the saved message", async () => {
    const dmChannel = {
      id: "dm-0123456789abcdef0123456789abcdef01234567",
      name: "Bob",
      kind: "dm",
      scope: "personal",
      groupSlug: null,
      isSharee: false,
      dmPeer: "bob",
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
    vi.mocked(openChatDm).mockResolvedValue(dmChannel);
    vi.mocked(sendChatMessage).mockImplementation(async (channelId, body) => ({
      ...wireMessage(body.id, body.body),
      channelId,
    }));

    // Queued offline against the virtual DM-rail id — the dm collection did
    // not exist yet when the user hit send.
    await upsertChatMessageInCache(
      username,
      { ...pendingMessage(ULID_A, "offline dm"), channelId: "dm:bob" },
      true,
    );
    await enqueueChatSend(username, {
      messageId: ULID_A,
      channelId: "dm:bob",
      body: "offline dm",
      parentId: null,
    });

    const result = await flushMeetChatOutbox(username);

    expect(result).toEqual({ flushed: 1, failed: 0 });
    expect(openChatDm).toHaveBeenCalledWith("bob");
    expect(sendChatMessage).toHaveBeenCalledWith(
      dmChannel.id,
      expect.objectContaining({ id: ULID_A, body: "offline dm" }),
    );
    // The cached row keeps the virtual id the workspace reads conversations by.
    expect((await getCachedChatMessage(username, ULID_A))?.channelId).toBe("dm:bob");
  });

  it("drops the queued message when its channel is gone on send replay", async () => {
    await upsertChatMessageInCache(username, pendingMessage(ULID_A, "homeless"), true);
    await enqueueChatSend(username, {
      messageId: ULID_A,
      channelId: "chat-deleted",
      body: "homeless",
      parentId: null,
    });
    vi.mocked(sendChatMessage).mockRejectedValue(new MeetChatRequestError("gone", 404));

    const result = await flushMeetChatOutbox(username);

    expect(result.flushed).toBe(1);
    expect(await getCachedChatMessage(username, ULID_A)).toBeUndefined();
  });
});
