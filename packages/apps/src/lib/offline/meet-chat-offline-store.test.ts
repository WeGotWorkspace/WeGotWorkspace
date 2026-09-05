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
import {
  readMeetChatBootstrapFromCache,
  upsertChatChannelInCache,
  writeMeetChatBootstrapMetaToCache,
  writeMeetChatDirectoryToCache,
} from "@/lib/offline/meet-chat-offline-store";

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
