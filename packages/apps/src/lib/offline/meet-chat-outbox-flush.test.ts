import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@/meet-core/src/meet-types";
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
} from "@/lib/offline/meet-chat-offline-store";
import { flushMeetChatOutbox } from "@/lib/offline/meet-chat-outbox-flush";

vi.mock("@/lib/api/wgw/meet-chat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/wgw/meet-chat")>();
  return {
    ...actual,
    sendChatMessage: vi.fn(),
    patchChatMessage: vi.fn(),
    deleteChatMessage: vi.fn(),
    toggleChatReaction: vi.fn(),
    putChatReadMarker: vi.fn(),
  };
});

import {
  deleteChatMessage,
  MeetChatRequestError,
  patchChatMessage,
  putChatReadMarker,
  sendChatMessage,
  toggleChatReaction,
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

    expect(result).toEqual({ flushed: 3, failedMessageIds: [] });
    expect(calls).toEqual(["send", "react", "readMarker"]);
    expect(await listMeetChatOutbox(username)).toHaveLength(0);
    expect(await listPendingChatMessageIds(username)).toEqual([]);
    expect((await getCachedChatMessage(username, ULID_B))?.reactions).toEqual([
      { emoji: "👍", authors: ["alice"] },
    ]);
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
    expect(first.failedMessageIds).toEqual([ULID_A]);

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
