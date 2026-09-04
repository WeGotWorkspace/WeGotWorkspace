import type { ChatMessage } from "@/meet-core/src/meet-types";
import type { WgwChatChannel } from "@/lib/api/wgw/meet-chat";
import {
  listCachedChatChannels,
  listCachedChatMessages,
  listMeetChatOutbox,
  listPendingChatMessageIds,
  meetChatOutboxMessageId,
  removeChatChannelFromCache,
  removeChatMessageFromCache,
  upsertChatChannelInCache,
  upsertChatMessageInCache,
} from "@/lib/offline/meet-chat-offline-store";

/**
 * Ids the inbound path must not clobber: Dexie rows still pendingSync plus any
 * id referenced by a queued outbox mutation (edit/delete/react on an already
 * synced message keeps the row non-pending but the outbox row authoritative).
 */
async function protectedMessageIds(username: string): Promise<Set<string>> {
  const pending = new Set(await listPendingChatMessageIds(username));
  for (const row of await listMeetChatOutbox(username)) {
    const id = meetChatOutboxMessageId(row);
    if (id) pending.add(id);
  }
  return pending;
}

/**
 * Ingest a remote message into Dexie. Rows owned by a pending local write are
 * skipped — the outbox flush replays the local op and the next poll converges.
 */
export async function ingestRemoteChatMessage(
  username: string,
  message: ChatMessage,
): Promise<"upserted" | "skipped-pending"> {
  if (!message.id) return "skipped-pending";
  const pending = await protectedMessageIds(username);
  if (pending.has(message.id)) return "skipped-pending";
  await upsertChatMessageInCache(username, message, false);
  return "upserted";
}

/** Drop a remotely destroyed message unless a local pending write still owns the id. */
export async function ingestRemoteChatMessageDestroyed(
  username: string,
  messageId: string,
): Promise<"removed" | "skipped-pending"> {
  const pending = await protectedMessageIds(username);
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
  const pending = await protectedMessageIds(username);
  const remoteChannelIds = new Set(channels.map((channel) => channel.id));
  const remoteMessageIds = new Set(messages.map((message) => message.id));

  for (const channel of channels) {
    await ingestRemoteChatChannel(username, channel);
  }
  for (const message of messages) {
    await ingestRemoteChatMessage(username, message);
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
