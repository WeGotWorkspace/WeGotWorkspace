import type { ChatMessage } from "@/meet-core/src/meet-types";
import type { WgwChatChannel } from "@/lib/api/wgw/meet-chat";
import { meetDirectMessagePrincipalId } from "@/meet-core/src/meet-direct-messages";
import {
  findCachedDmChannelByPeer,
  listCachedChatChannels,
  listCachedChatMessages,
  upsertChatChannelInCache,
} from "@/lib/offline/meet-chat-offline-store";

/** Max Crockford ULID — marks every existing message read when history is empty. */
export const MEET_CHAT_CAUGHT_UP_READ_UID = "7ZZZZZZZZZZZZZZZZZZZZZZZZZ";

export type MeetChatReadMarkerTarget = {
  lastReadTs: string;
  lastReadUid: string;
};

export function utcDateTimeFromEpochMs(ms: number): string {
  return new Date(ms).toISOString();
}

/** Latest cached message in a UI channel (`dm:{peer}` or real id), ULID-tiebroken. */
export function latestMessageInChannel(
  messages: readonly ChatMessage[],
  channelId: string,
): ChatMessage | undefined {
  let latest: ChatMessage | undefined;
  for (const message of messages) {
    if (message.channelId !== channelId) continue;
    if (!latest) {
      latest = message;
      continue;
    }
    if (message.createdAt > latest.createdAt) {
      latest = message;
      continue;
    }
    if (message.createdAt === latest.createdAt && message.id > latest.id) {
      latest = message;
    }
  }
  return latest;
}

export function meetChatReadMarkerTarget(
  latest: ChatMessage | undefined,
  now: () => number = Date.now,
): MeetChatReadMarkerTarget {
  if (!latest) {
    return {
      lastReadTs: utcDateTimeFromEpochMs(now()),
      lastReadUid: MEET_CHAT_CAUGHT_UP_READ_UID,
    };
  }
  return {
    lastReadTs: utcDateTimeFromEpochMs(latest.createdAt),
    lastReadUid: latest.id,
  };
}

/** Skip a PUT when the cache is already caught up to this last message. */
export function shouldSkipMeetChatReadMarker(
  unreadCount: number,
  target: MeetChatReadMarkerTarget,
  lastSent: MeetChatReadMarkerTarget | undefined,
): boolean {
  return unreadCount === 0 && lastSent?.lastReadUid === target.lastReadUid;
}

/** Wire row for a UI channel id (virtual DM rail or real collection id). */
export async function findCachedChannelForUiId(
  username: string,
  channelId: string,
): Promise<WgwChatChannel | undefined> {
  const peer = meetDirectMessagePrincipalId(channelId);
  if (peer) return findCachedDmChannelByPeer(username, peer);
  const channels = await listCachedChatChannels(username);
  return channels.find((row) => row.id === channelId);
}

export async function latestCachedMessageForChannel(
  username: string,
  channelId: string,
): Promise<ChatMessage | undefined> {
  return latestMessageInChannel(await listCachedChatMessages(username), channelId);
}

export async function zeroCachedChannelUnread(username: string, channelId: string): Promise<void> {
  const row = await findCachedChannelForUiId(username, channelId);
  if (!row || (row.unreadCount ?? 0) === 0) return;
  await upsertChatChannelInCache(username, { ...row, unreadCount: 0 });
}
