/**
 * DM identity translation (Epic #701, chunk G).
 *
 * The workspace addresses direct messages by the *virtual* DM-rail id
 * `dm:{peerPrincipal}` (meet-core/meet-direct-messages), while the server
 * stores them as real `dm-{hash}` collections whose `dmPeer` field names the
 * other member. The Dexie cache keeps channels in wire shape (real ids) but
 * caches DM *messages* under the virtual id, so everything the UI reads is
 * already keyed the way `MeetWorkspace` looks conversations up. These pure
 * helpers are the single mapping between the two worlds; the async cache
 * lookups live in meet-chat-offline-store.
 */
import type { WgwChatChannel } from "@/lib/api/wgw/meet-chat";
import type { ChatMessage } from "@/meet-core/src/meet-types";
import { meetDirectMessageChannelId } from "@/meet-core/src/meet-direct-messages";

/** Virtual DM-rail channel id (`dm:{peer}`) for a wire dm row; null for other kinds. */
export function uiDmChannelIdForWire(channel: WgwChatChannel): string | null {
  if (channel.kind !== "dm" || !channel.dmPeer) return null;
  return meetDirectMessageChannelId(channel.dmPeer);
}

/** UI channel id for a wire row: dm rows map to `dm:{peer}`, everything else keeps its id. */
export function uiChannelIdForWire(channel: WgwChatChannel): string {
  return uiDmChannelIdForWire(channel) ?? channel.id;
}

/** Real channel id → virtual `dm:{peer}` id, for re-keying inbound dm messages. */
export function buildUiChannelIdMap(channels: readonly WgwChatChannel[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const channel of channels) {
    const uiId = uiDmChannelIdForWire(channel);
    if (uiId) map.set(channel.id, uiId);
  }
  return map;
}

/** Re-key a wire-derived message onto its UI channel id (no-op outside dm channels). */
export function uiChatMessageFromMap(
  message: ChatMessage,
  uiIdByChannel: ReadonlyMap<string, string>,
): ChatMessage {
  const uiId = uiIdByChannel.get(message.channelId);
  return uiId ? { ...message, channelId: uiId } : message;
}

/** Live DM unread badge counts keyed by peer principal (`MeetUIData.dmUnread`). */
export function dmUnreadFromWireChannels(
  channels: readonly WgwChatChannel[],
): Record<string, number> {
  const unread: Record<string, number> = {};
  for (const channel of channels) {
    if (channel.kind !== "dm" || !channel.dmPeer) continue;
    const count = channel.unreadCount ?? 0;
    if (count > 0) unread[channel.dmPeer] = count;
  }
  return unread;
}
