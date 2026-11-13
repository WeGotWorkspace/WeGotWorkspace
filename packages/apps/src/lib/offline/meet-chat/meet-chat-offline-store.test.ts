import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import type { WgwChatChannel } from "@/lib/api/wgw/meet-chat";
import { DEFAULT_RTC_SETTINGS } from "@/lib/rtc/types";
import type { WorkspaceSession } from "@/lib/workspace/workspace-session";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import {
  meetChatChannelsTable,
  meetChatMessagesTable,
} from "@/lib/offline/meet-chat/meet-chat-schema";
import { markOutboxError } from "@/lib/offline/core/outbox-store";
import type { ChatMessage } from "@/lib/models/meet-types";
import {
  enqueueChatEdit,
  enqueueChatReactionToggle,
  enqueueChatSend,
  getCachedChatMessage,
  readMeetChatBootstrapFromCache,
  upsertChatChannelInCache,
  upsertChatMessageInCache,
  writeMeetChatBootstrapMetaToCache,
  writeMeetChatDirectoryToCache,
} from "@/lib/offline/meet-chat/meet-chat-offline-store";

const username = "alice";

const session: WorkspaceSession = {
  user: { displayName: "Alice", initials: "A", username },
  viewerInboxLabel: "me",
};

const channel: WgwChatChannel = {
  id: "chat-general",
  name: "General",
  kind: "channel",
  scope: "personal",
  groupSlug: null,
  isSharee: false,
  shareWith: null,
  unreadCount: 0,
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

describe("meet chat directory cache", () => {
  beforeEach(async () => {
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await db.outbox.clear();
    await db.meta.clear();
    await meetChatChannelsTable(db).clear();
    await meetChatMessagesTable(db).clear();
  });

  it("round-trips directory and groups with the cached bootstrap snapshot", async () => {
    await writeMeetChatBootstrapMetaToCache(username, session, DEFAULT_RTC_SETTINGS);
    await upsertChatChannelInCache(username, channel);
    await writeMeetChatDirectoryToCache(
      username,
      [
        { id: "bob", displayName: "Bob", principalType: "user" },
        { id: "carol", displayName: "Carol", principalType: "user" },
      ],
      [{ slug: "editorial", displayName: "Editorial" }],
    );

    const cached = await readMeetChatBootstrapFromCache(username);
    expect(cached?.channels.map((row) => row.id)).toEqual(["chat-general"]);
    expect(cached?.directory?.map((row) => row.id)).toEqual(["bob", "carol"]);
    expect(cached?.groups).toEqual([{ slug: "editorial", displayName: "Editorial" }]);
  });

  it("omits directory until a live fetch has been cached", async () => {
    await writeMeetChatBootstrapMetaToCache(username, session, DEFAULT_RTC_SETTINGS);
    const cached = await readMeetChatBootstrapFromCache(username);
    expect(cached?.directory).toBeUndefined();
    expect(cached?.groups).toBeUndefined();
  });
});

describe("meet chat message sync state", () => {
  beforeEach(async () => {
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await db.outbox.clear();
    await db.meta.clear();
    await meetChatChannelsTable(db).clear();
    await meetChatMessagesTable(db).clear();
    await writeMeetChatBootstrapMetaToCache(username, session, DEFAULT_RTC_SETTINGS);
    await upsertChatChannelInCache(username, channel);
  });

  const message = (id: string, body: string): ChatMessage => ({
    id,
    channelId: "chat-general",
    authorId: "alice",
    authorName: "Alice",
    body,
    createdAt: Date.now(),
    reactions: [],
    mentions: [],
    previews: [],
  });

  async function stateOf(id: string) {
    const cached = await readMeetChatBootstrapFromCache(username);
    return cached?.messages.find((row) => row.id === id)?.syncState;
  }

  it("is pending while a send is queued, failed once it failed, and absent once sent", async () => {
    await upsertChatMessageInCache(username, message("m1", "queued"), true);
    await enqueueChatSend(username, {
      messageId: "m1",
      channelId: "chat-general",
      body: "queued",
      parentId: null,
    });
    expect(await stateOf("m1")).toBe("pending");

    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    const [row] = await db.outbox.toArray();
    await markOutboxError(username, row!.id, "forbidden", 403);
    expect(await stateOf("m1")).toBe("failed");

    await db.outbox.clear();
    await upsertChatMessageInCache(username, message("m1", "queued"), false);
    expect(await stateOf("m1")).toBeUndefined();
  });

  it("leaves a queued reaction out: it is not the message's content", async () => {
    await upsertChatMessageInCache(username, message("m2", "theirs"), false);
    await enqueueChatReactionToggle(username, { messageId: "m2", emoji: "👍" });
    expect(await stateOf("m2")).toBeUndefined();
    await enqueueChatEdit(username, { messageId: "m2", body: "edited" });
    expect(await stateOf("m2")).toBe("pending");
  });

  it("never stores the derived state", async () => {
    await upsertChatMessageInCache(username, { ...message("m3", "x"), syncState: "failed" });
    expect((await getCachedChatMessage(username, "m3"))?.syncState).toBeUndefined();
  });
});
