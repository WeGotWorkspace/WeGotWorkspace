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
  runScopedInbound,
  type ScopeChanges,
  type ScopedInboundBinding,
} from "@/lib/offline/core/inbound-sync";
import {
  ingestRemoteChatChannel,
  ingestRemoteChatChannelDestroyed,
  ingestRemoteChatMessage,
  ingestRemoteChatMessageDestroyed,
  listChatMessageIdsBlockingSyncToken,
  readChatProtectedMessageIds,
} from "@/lib/offline/meet-chat-jmap-inbound";
import {
  listCachedChatChannels,
  listCachedChatMessageIdsForChannel,
  markChatChannelBackfilled,
  MEET_CHAT_CHANNELS_TOKEN_SCOPE,
  readChatChannelMessageCursor,
  readMeetChatSyncToken,
  readUiChannelIdMap,
  writeChatChannelMessageCursor,
  writeMeetChatSyncToken,
} from "@/lib/offline/meet-chat-offline-store";

const PAGE_SIZE = 200;
/** Safety cap on paging loops (history, changes drain) inside one sync pass. */
const MAX_PAGES = 500;

export type MeetChatInboundSyncResult = {
  changed: boolean;
  usedFullResync: boolean;
};

type CachedChatMessage = { id: string; scope: string };

/** Every message of a channel, newest page first, paged with the `before` ULID cursor. */
async function listWholeChannel(channelId: string): Promise<WgwChatMessage[]> {
  const rows: WgwChatMessage[] = [];
  let before: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await listChatMessages(channelId, {
      ...(before ? { before } : {}),
      limit: PAGE_SIZE,
    });
    rows.push(...result.list);
    if (!result.hasMore || result.list.length === 0) break;
    // Pages are ascending by ULID; the oldest id keys the next older window.
    before = result.list.reduce((min, row) => (row.id < min ? row.id : min), result.list[0]!.id);
  }
  return rows;
}

/** Messages newer than `since`, oldest page first. */
async function listSinceCursor(channelId: string, since: string): Promise<WgwChatMessage[]> {
  const rows: WgwChatMessage[] = [];
  let cursor = since;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await listChatMessages(channelId, { since: cursor, limit: PAGE_SIZE });
    rows.push(...result.list);
    if (!result.hasMore || result.list.length === 0) break;
    cursor = result.list.reduce((max, row) => (row.id > max ? row.id : max), cursor);
  }
  return rows;
}

/** Drain a channel's `/changes` pages into one delta. */
async function drainMessageChanges(channelId: string, since: string): Promise<ScopeChanges> {
  const created = new Set<string>();
  const updated = new Set<string>();
  const destroyed = new Set<string>();
  let state = since;
  for (let page = 0; page < MAX_PAGES; page++) {
    const delta = await listChatMessageChanges(channelId, state);
    for (const id of delta.created) created.add(id);
    for (const id of delta.updated) updated.add(id);
    for (const id of delta.destroyed) destroyed.add(id);
    state = delta.newState;
    if (!delta.hasMoreChanges) break;
  }
  return {
    created: [...created],
    updated: [...updated],
    destroyed: [...destroyed],
    newState: state,
  };
}

/**
 * One channel's messages bound to the shared inbound engine. The REST surface
 * has no message-by-id GET, so `changes` reads the rows it names up front:
 * new messages page from the `since` cursor (the highest ULID ingested), and
 * an edit, or a message the cursor cannot reach (a ULID minted offline by a
 * peer before the cursor), re-lists the channel. `fetch` answers from those
 * rows; an id they lack is gone.
 */
function chatMessagesBinding(
  username: string,
  channelId: string,
  uiChannelId: string,
  uiIdByChannel: ReadonlyMap<string, string>,
): ScopedInboundBinding<WgwChatMessage, CachedChatMessage> {
  const rows = new Map<string, WgwChatMessage>();
  const remember = (list: readonly WgwChatMessage[]) => {
    for (const row of list) rows.set(row.id, row);
  };

  return {
    readToken: (scope) => readMeetChatSyncToken(username, scope),
    writeToken: async (scope, token) => {
      // Every remembered row has been ingested (or skipped for a queued write
      // that holds the token, in which case this is not called).
      const newest = [...rows.keys()].reduce<string | null>(
        (max, id) => (max === null || id > max ? id : max),
        null,
      );
      if (newest) await writeChatChannelMessageCursor(username, scope, newest);
      await writeMeetChatSyncToken(username, scope, token);
      await markChatChannelBackfilled(username, scope);
    },
    changes: async (scope, since) => {
      const delta = await drainMessageChanges(scope, since);
      const named = [...delta.created, ...delta.updated];
      const missing = () => named.filter((id) => !rows.has(id));
      const cursor = await readChatChannelMessageCursor(username, scope);
      if (delta.updated.length === 0 && delta.created.length > 0 && cursor) {
        remember(await listSinceCursor(scope, cursor));
      }
      if (missing().length > 0) remember(await listWholeChannel(scope));
      return delta;
    },
    isCannotCalculateChanges: isMeetChatCannotCalculateChanges,
    list: async (scope) => {
      const list = await listWholeChannel(scope);
      remember(list);
      return list;
    },
    currentState: async (scope) => (await listChatMessageChanges(scope, null)).newState,
    rowId: (row) => row.id,
    fetch: async (id) => rows.get(id) ?? null,
    readCached: async () => {
      // DM messages cache under the virtual `dm:{peer}` id: read that one,
      // and report them under this channel's REST id, the engine's scope.
      const ids = await listCachedChatMessageIdsForChannel(username, uiChannelId);
      const kept = await readChatProtectedMessageIds(username);
      return {
        items: ids.map((id) => ({ id, scope: channelId })),
        keep: (item) => kept.has(item.id),
      };
    },
    scopeGone: {
      matches: isMeetChatGone,
      apply: (scope) => ingestRemoteChatChannelDestroyed(username, scope).then(() => {}),
    },
    createApplier: async () => ({
      ingest: (row) => ingestRemoteChatMessage(username, chatMessageFromWire(row), uiIdByChannel),
      ingestDestroyed: (id) => ingestRemoteChatMessageDestroyed(username, id),
      blocksToken: await listChatMessageIdsBlockingSyncToken(username),
    }),
  };
}

/**
 * Pull one channel's messages through the shared engine: changes since its
 * token, or, with no token yet, its whole history (the first backfill: the
 * spec keeps the whole timeline offline).
 */
export async function syncChatChannelMessages(
  username: string,
  channelId: string,
): Promise<MeetChatInboundSyncResult> {
  const uiIdByChannel = await readUiChannelIdMap(username);
  const uiChannelId = uiIdByChannel.get(channelId) ?? channelId;
  return runScopedInbound(
    [channelId],
    chatMessagesBinding(username, channelId, uiChannelId, uiIdByChannel),
  );
}

/** First pull of a channel shared or created elsewhere (live inbound). */
export async function backfillChatChannelHistory(
  username: string,
  channelId: string,
): Promise<void> {
  await syncChatChannelMessages(username, channelId);
}

async function syncChannels(username: string): Promise<MeetChatInboundSyncResult> {
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

/**
 * REST changes-feed inbound (reconnect, manual refresh, first backfill). The
 * live poll uses `POST /jmap` via `JmapChatAdapter`. Channels first, then each
 * cached channel's messages through the shared engine. A channel whose pull
 * fails keeps its token and the next channels still run; the first error is
 * rethrown once every channel had its turn.
 */
export async function syncMeetChatInboundFromRest(
  username: string,
): Promise<MeetChatInboundSyncResult> {
  if (!username) return { changed: false, usedFullResync: false };

  const channels = await syncChannels(username);
  let changed = channels.changed;
  let usedFullResync = channels.usedFullResync;
  let failure: { error: unknown } | null = null;

  for (const channel of await listCachedChatChannels(username)) {
    try {
      const result = await syncChatChannelMessages(username, channel.id);
      changed = changed || result.changed;
      usedFullResync = usedFullResync || result.usedFullResync;
    } catch (error) {
      failure ??= { error };
    }
  }

  if (failure) throw failure.error;
  return { changed, usedFullResync };
}
