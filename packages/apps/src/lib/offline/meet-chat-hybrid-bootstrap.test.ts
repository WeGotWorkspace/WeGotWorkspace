import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

const liveBootstrap = {
  session,
  data: {
    defaultDisplayName: "Alice",
    rtc: DEFAULT_RTC_SETTINGS,
  },
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

const cachedDirectory = [
  { id: "bob", displayName: "Bob", principalType: "user" as const },
  { id: "carol", displayName: "Carol", principalType: "user" as const },
];

vi.mock("@/lib/offline/core/browser-online", () => ({
  readBrowserOnline: vi.fn(() => true),
  getConnectivitySnapshot: vi.fn(() => true),
  subscribeBrowserOnline: vi.fn(() => () => undefined),
  isFetchNetworkError: vi.fn(() => false),
}));

vi.mock("@/lib/api/wgw/meet", () => ({
  fetchMeetLiveBootstrap: vi.fn(),
}));

vi.mock("@/lib/api/wgw/meet-chat-directory", () => ({
  fetchMeetChatDirectory: vi.fn(),
}));

vi.mock("@/lib/offline/meet-chat-inbound-sync", () => ({
  syncMeetChatInboundFromRest: vi.fn(),
}));

import { fetchMeetLiveBootstrap } from "@/lib/api/wgw/meet";
import { fetchMeetChatDirectory } from "@/lib/api/wgw/meet-chat-directory";
import { syncMeetChatInboundFromRest } from "@/lib/offline/meet-chat-inbound-sync";
import {
  fetchMeetChatHybridBootstrap,
  meetChatBootstrapFromCached,
} from "@/lib/offline/meet-chat-hybrid-operations";

function neverResolves<T>(): Promise<T> {
  return new Promise(() => undefined);
}

describe("fetchMeetChatHybridBootstrap directory", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(fetchMeetLiveBootstrap).mockResolvedValue(liveBootstrap);
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await db.outbox.clear();
    await db.meta.clear();
    await meetChatChannelsTable(db).clear();
    await meetChatMessagesTable(db).clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns cached directory without waiting for directory fetch or inbound sync", async () => {
    await writeMeetChatBootstrapMetaToCache(username, session, DEFAULT_RTC_SETTINGS);
    await upsertChatChannelInCache(username, channel);
    await writeMeetChatDirectoryToCache(username, cachedDirectory, [
      { slug: "editorial", displayName: "Editorial" },
    ]);

    vi.mocked(fetchMeetChatDirectory).mockReturnValue(neverResolves());
    vi.mocked(syncMeetChatInboundFromRest).mockReturnValue(neverResolves());

    const result = await fetchMeetChatHybridBootstrap();

    expect(syncMeetChatInboundFromRest).not.toHaveBeenCalled();
    expect(result.data.channels?.map((row) => row.id)).toEqual(["chat-general"]);
    expect(result.data.directory?.map((row) => row.id)).toEqual(["bob", "carol"]);
    expect(result.data.groups).toEqual([{ slug: "editorial", displayName: "Editorial" }]);
  });

  it("does not wait for inbound sync before returning a live directory when channels are already cached", async () => {
    await writeMeetChatBootstrapMetaToCache(username, session, DEFAULT_RTC_SETTINGS);
    await upsertChatChannelInCache(username, channel);

    vi.mocked(fetchMeetChatDirectory).mockResolvedValue({
      directory: cachedDirectory,
      groups: [{ slug: "studio", displayName: "Studio" }],
    });
    vi.mocked(syncMeetChatInboundFromRest).mockReturnValue(neverResolves());

    const result = await fetchMeetChatHybridBootstrap();

    expect(syncMeetChatInboundFromRest).not.toHaveBeenCalled();
    expect(result.data.directory?.map((row) => row.id)).toEqual(["bob", "carol"]);
    expect(result.data.groups).toEqual([{ slug: "studio", displayName: "Studio" }]);
    expect(await readMeetChatBootstrapFromCache(username)).toMatchObject({
      directory: cachedDirectory,
      groups: [{ slug: "studio", displayName: "Studio" }],
    });
  });

  it("exposes cached directory through meetChatBootstrapFromCached for the cache-first paint", async () => {
    await writeMeetChatBootstrapMetaToCache(username, session, DEFAULT_RTC_SETTINGS);
    await writeMeetChatDirectoryToCache(username, cachedDirectory, []);
    const cached = await readMeetChatBootstrapFromCache(username);
    expect(cached).toBeTruthy();
    const bootstrap = meetChatBootstrapFromCached(cached!);
    expect(bootstrap.data.directory?.map((row) => row.id)).toEqual(["bob", "carol"]);
  });
});
