import {
  chatMessageFromWire,
  getChatChannel,
  isMeetChatCannotCalculateChanges,
  isMeetChatGone,
  listChatChannelChanges,
  listChatChannels,
  listChatMessageChanges,
  listChatMessages,
  type WgwChatMessage,
} from "@/lib/api/wgw/meet-chat";
import {
  ingestRemoteChatChannel,
  ingestRemoteChatChannelDestroyed,
  ingestRemoteChatMessage,
  ingestRemoteChatMessageDestroyed,
} from "@/lib/offline/meet-chat-jmap-inbound";
import {
  isChatChannelBackfilled,
  listCachedChatChannels,
  listCachedChatMessages,
  listPendingChatMessageIds,
  markChatChannelBackfilled,
  MEET_CHAT_CHANNELS_TOKEN_SCOPE,
  readChatChannelMessageCursor,
  readMeetChatSyncToken,
  removeChatMessageFromCache,
  writeChatChannelMessageCursor,
  writeMeetChatSyncToken,
} from "@/lib/offline/meet-chat-offline-store";

const BACKFILL_PAGE_SIZE = 200;
/** Safety cap on paging loops (backfill / changes drain) inside one sync pass. */
const MAX_PAGES = 500;

export type MeetChatInboundSyncResult = {
  changed: boolean;
  usedFullResync: boolean;
};

async function ingestWirePage(username: string, page: WgwChatMessage[]): Promise<boolean> {
  let changed = false;
  for (const row of page) {
    const result = await ingestRemoteChatMessage(username, chatMessageFromWire(row));
    if (result === "upserted") changed = true;
  }
  return changed;
}

async function bumpCursorFromPage(
  username: string,
  channelId: string,
  page: WgwChatMessage[],
): Promise<void> {
  let max: string | null = null;
  for (const row of page) {
    if (max === null || row.id > max) max = row.id;
  }
  if (max) await writeChatChannelMessageCursor(username, channelId, max);
}

/**
 * Full-history backfill for one channel: page **older** history with the
 * `before` ULID cursor until `hasMore` clears, then prime the changes token so
 * the incremental path takes over. Local-first reads require the whole
 * timeline in Dexie (spec: "history always available offline").
 */
export async function backfillChatChannelHistory(username: string, channelId: string): Promise<void> {
  let before: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await listChatMessages(channelId, {
      ...(before ? { before } : {}),
      limit: BACKFILL_PAGE_SIZE,
    });
    await ingestWirePage(username, result.list);
    await bumpCursorFromPage(username, channelId, result.list);
    if (!result.hasMore || result.list.length === 0) break;
    // Pages are ascending by ULID; the oldest id keys the next older window.
    before = result.list.reduce((min, row) => (row.id < min ? row.id : min), result.list[0]!.id);
  }
  const primed = await listChatMessageChanges(channelId, null);
  await writeMeetChatSyncToken(username, channelId, primed.newState);
  await markChatChannelBackfilled(username, channelId);
}

/**
 * Re-list a channel completely and reconcile Dexie against it (pending local
 * writes survive). REST fallback for edits/tombstones of old messages — the
 * REST surface has no message-by-id GET, so changed old ids cannot be fetched
 * individually; the JMAP poll (`ChatMessage/get`) is the efficient live path.
 */
async function relistChannelMessages(username: string, channelId: string): Promise<boolean> {
  const seen = new Set<string>();
  let before: string | undefined;
  let changed = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await listChatMessages(channelId, {
      ...(before ? { before } : {}),
      limit: BACKFILL_PAGE_SIZE,
    });
    for (const row of result.list) seen.add(row.id);
    if (await ingestWirePage(username, result.list)) changed = true;
    await bumpCursorFromPage(username, channelId, result.list);
    if (!result.hasMore || result.list.length === 0) break;
    before = result.list.reduce((min, row) => (row.id < min ? row.id : min), result.list[0]!.id);
  }
  const pending = new Set(await listPendingChatMessageIds(username));
  for (const message of await listCachedChatMessages(username)) {
    if (message.channelId !== channelId) continue;
    if (seen.has(message.id) || pending.has(message.id)) continue;
    await removeChatMessageFromCache(username, message.id);
    changed = true;
  }
  return changed;
}

async function syncChannels(username: string): Promise<{ changed: boolean; usedFullResync: boolean }> {
  const since = await readMeetChatSyncToken(username, MEET_CHAT_CHANNELS_TOKEN_SCOPE);
  let changed = false;
  try {
    const delta = await listChatChannelChanges(since);
    for (const id of [...delta.created, ...delta.updated]) {
      if (delta.destroyed.includes(id)) continue;
      try {
        await ingestRemoteChatChannel(username, await getChatChannel(id));
        changed = true;
      } catch (error) {
        if (!isMeetChatGone(error)) throw error;
        await ingestRemoteChatChannelDestroyed(username, id);
        changed = true;
      }
    }
    for (const id of delta.destroyed) {
      await ingestRemoteChatChannelDestroyed(username, id);
      changed = true;
    }
    await writeMeetChatSyncToken(username, MEET_CHAT_CHANNELS_TOKEN_SCOPE, delta.newState);
    return { changed, usedFullResync: false };
  } catch (error) {
    if (!isMeetChatCannotCalculateChanges(error)) throw error;
    const remote = await listChatChannels();
    const remoteIds = new Set(remote.map((row) => row.id));
    for (const row of remote) {
      await ingestRemoteChatChannel(username, row);
    }
    for (const cached of await listCachedChatChannels(username)) {
      if (remoteIds.has(cached.id)) continue;
      await ingestRemoteChatChannelDestroyed(username, cached.id);
    }
    const primed = await listChatChannelChanges(null);
    await writeMeetChatSyncToken(username, MEET_CHAT_CHANNELS_TOKEN_SCOPE, primed.newState);
    return { changed: true, usedFullResync: true };
  }
}

async function syncChannelMessages(
  username: string,
  channelId: string,
): Promise<{ changed: boolean; usedFullResync: boolean }> {
  if (!(await isChatChannelBackfilled(username, channelId))) {
    await backfillChatChannelHistory(username, channelId);
    return { changed: true, usedFullResync: false };
  }
  const since = await readMeetChatSyncToken(username, channelId);
  if (!since) {
    const primed = await listChatMessageChanges(channelId, null);
    await writeMeetChatSyncToken(username, channelId, primed.newState);
    return relistThenReport(username, channelId);
  }
  try {
    let created = false;
    let updatedOrDestroyed = false;
    let state = since;
    for (let page = 0; page < MAX_PAGES; page++) {
      const delta = await listChatMessageChanges(channelId, state);
      if (delta.created.length > 0) created = true;
      if (delta.updated.length > 0 || delta.destroyed.length > 0) updatedOrDestroyed = true;
      state = delta.newState;
      if (!delta.hasMoreChanges) break;
    }
    let changed = false;
    if (updatedOrDestroyed) {
      changed = await relistChannelMessages(username, channelId);
    } else if (created) {
      changed = await ingestNewMessagesSinceCursor(username, channelId);
    }
    await writeMeetChatSyncToken(username, channelId, state);
    return { changed, usedFullResync: false };
  } catch (error) {
    if (isMeetChatGone(error)) {
      await ingestRemoteChatChannelDestroyed(username, channelId);
      return { changed: true, usedFullResync: false };
    }
    if (!isMeetChatCannotCalculateChanges(error)) throw error;
    const changed = await relistChannelMessages(username, channelId);
    const primed = await listChatMessageChanges(channelId, null);
    await writeMeetChatSyncToken(username, channelId, primed.newState);
    return { changed, usedFullResync: true };
  }
}

async function relistThenReport(
  username: string,
  channelId: string,
): Promise<{ changed: boolean; usedFullResync: boolean }> {
  const changed = await relistChannelMessages(username, channelId);
  return { changed, usedFullResync: false };
}

/** New messages only: ascending `since`-cursor pages from the last ingested ULID. */
async function ingestNewMessagesSinceCursor(
  username: string,
  channelId: string,
): Promise<boolean> {
  const cursor = await readChatChannelMessageCursor(username, channelId);
  if (!cursor) return relistChannelMessages(username, channelId);
  let since = cursor;
  let changed = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await listChatMessages(channelId, { since, limit: BACKFILL_PAGE_SIZE });
    if (await ingestWirePage(username, result.list)) changed = true;
    await bumpCursorFromPage(username, channelId, result.list);
    if (!result.hasMore || result.list.length === 0) break;
    since = result.list.reduce((max, row) => (row.id > max ? row.id : max), since);
  }
  return changed;
}

/**
 * REST changes-feed inbound (reconnect / manual refresh / initial backfill).
 * The live poll uses `POST /jmap` via `JmapChatAdapter`. Channels first, then
 * per-cached-channel messages — full re-list only on `cannotCalculateChanges`
 * or when old messages changed (no by-id GET on the REST surface).
 */
export async function syncMeetChatInboundFromRest(
  username: string,
): Promise<MeetChatInboundSyncResult> {
  if (!username) return { changed: false, usedFullResync: false };

  const channels = await syncChannels(username);
  let changed = channels.changed;
  let usedFullResync = channels.usedFullResync;

  for (const channel of await listCachedChatChannels(username)) {
    const result = await syncChannelMessages(username, channel.id);
    changed = changed || result.changed;
    usedFullResync = usedFullResync || result.usedFullResync;
  }

  return { changed, usedFullResync };
}
