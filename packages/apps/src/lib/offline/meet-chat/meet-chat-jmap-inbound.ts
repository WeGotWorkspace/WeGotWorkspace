import type { ChatMessage } from "@/lib/models/meet-types";
import type { WgwChatChannel } from "@/lib/api/wgw/meet-chat";
import { readPendingWrites } from "@/lib/offline/core/inbound-sync";
import { isPermanentlyFailedOutboxRow } from "@/lib/offline/core/outbox-store";
import { buildUiChannelIdMap, uiChatMessageFromMap } from "@/lib/offline/meet-chat/meet-chat-dm";
import {
  listCachedChatChannels,
  listCachedChatMessages,
  listMeetChatOutbox,
  listPendingChatMessageIds,
  meetChatOutboxMessageId,
  readUiChannelIdMap,
  removeChatChannelFromCache,
  removeChatMessageFromCache,
  upsertChatChannelInCache,
  upsertChatMessageInCache,
} from "@/lib/offline/meet-chat/meet-chat-offline-store";

/**
 * Pending writes per message id, read through the shared engine: Dexie rows
 * still `pendingSync` plus every id a queued outbox row names (an edit,
 * delete or reaction on a synced message keeps the row non-pending, but the
 * outbox row is what the server has not seen yet).
 */
async function readChatPendingWrites(username: string) {
  return readPendingWrites(
    await listMeetChatOutbox(username),
    (row) => ({ id: meetChatOutboxMessageId(row) }),
    await listPendingChatMessageIds(username),
  );
}

/** Ids the inbound path must not clobber, and a full list must not remove. */
export async function readChatProtectedMessageIds(username: string): Promise<Set<string>> {
  return new Set((await readChatPendingWrites(username)).keys());
}

/**
 * Queued message ids whose skipped server change must come back next run, so
 * they hold their channel's token. A row the server refused for good (403 or
 * 404) waits for the person, like a conflict, and holds nothing.
 */
export async function listChatMessageIdsBlockingSyncToken(username: string): Promise<Set<string>> {
  const rows = (await listMeetChatOutbox(username)).filter(
    (row) => !isPermanentlyFailedOutboxRow(row),
  );
  const writes = readPendingWrites(rows, (row) => ({ id: meetChatOutboxMessageId(row) }));
  return new Set([...writes].filter(([, write]) => write.blocksToken).map(([id]) => id));
}

/**
 * Ingest a remote message into Dexie. Rows owned by a pending local write are
 * skipped — the outbox flush replays the local op and the next poll converges.
 * DM messages are re-keyed onto the virtual `dm:{peer}` channel id the
 * workspace selects; pass `uiIdByChannel` (readUiChannelIdMap) when ingesting
 * pages to avoid a per-message cache read.
 */
export async function ingestRemoteChatMessage(
  username: string,
  message: ChatMessage,
  uiIdByChannel?: ReadonlyMap<string, string>,
): Promise<"upserted" | "skipped-pending"> {
  if (!message.id) return "skipped-pending";
  const pending = await readChatProtectedMessageIds(username);
  if (pending.has(message.id)) return "skipped-pending";
  const map = uiIdByChannel ?? (await readUiChannelIdMap(username));
  await upsertChatMessageInCache(username, uiChatMessageFromMap(message, map), false);
  return "upserted";
}

/** Drop a remotely destroyed message unless a local pending write still owns the id. */
export async function ingestRemoteChatMessageDestroyed(
  username: string,
  messageId: string,
): Promise<"removed" | "skipped-pending"> {
  const pending = await readChatProtectedMessageIds(username);
  if (pending.has(messageId)) return "skipped-pending";
  await removeChatMessageFromCache(username, messageId);
  return "removed";
}

/** Upsert a remote channel (wire shape) into the Dexie channel list. */
export async function ingestRemoteChatChannel(
  username: string,
  channel: WgwChatChannel,
): Promise<"upserted"> {
  await upsertChatChannelInCache(username, channel);
  return "upserted";
}

/** Drop a remotely destroyed channel and its cached messages/tokens. */
export async function ingestRemoteChatChannelDestroyed(
  username: string,
  channelId: string,
): Promise<"removed"> {
  await removeChatChannelFromCache(username, channelId);
  return "removed";
}

/**
 * Full snapshot after `cannotCalculateChanges`: upsert remote rows, then drop
 * local channels/messages that are gone (pending local writes stay).
 */
export async function reconcileMeetChatSnapshot(
  username: string,
  channels: WgwChatChannel[],
  messages: ChatMessage[],
): Promise<void> {
  const pending = await readChatProtectedMessageIds(username);
  const remoteChannelIds = new Set(channels.map((channel) => channel.id));
  const remoteMessageIds = new Set(messages.map((message) => message.id));

  for (const channel of channels) {
    await ingestRemoteChatChannel(username, channel);
  }
  const uiIdByChannel = buildUiChannelIdMap(channels);
  for (const message of messages) {
    await ingestRemoteChatMessage(username, message, uiIdByChannel);
  }
  for (const message of await listCachedChatMessages(username)) {
    if (remoteMessageIds.has(message.id) || pending.has(message.id)) continue;
    await removeChatMessageFromCache(username, message.id);
  }
  for (const channel of await listCachedChatChannels(username)) {
    if (remoteChannelIds.has(channel.id)) continue;
    await removeChatChannelFromCache(username, channel.id);
  }
}
