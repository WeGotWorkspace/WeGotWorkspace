import { meetCollectionIdFromPublic } from "@/meet-core/src/meet-public-id";
import type { MeetChannel } from "@/meet-core/src/meet-types";

/**
 * Deterministic RTC room id for a chat channel — agreed convention with the API
 * layer: the room id IS the channel id (`chat-{ulid}` / `dm-…`), lowercased to
 * match the signaling layer's lowercase room codes (`joinRoom` normalizes the
 * same way). Meeting-kind channels keep their reserved `guestRoomCode` so
 * calendar invites and guest links stay valid.
 */
export function meetChannelRoomId(
  channel: Pick<MeetChannel, "id" | "kind" | "guestRoomCode">,
): string {
  const guestRoom = channel.kind === "meeting" ? channel.guestRoomCode?.trim() : null;
  if (guestRoom) return guestRoom.toLowerCase();
  return channel.id.trim().toLowerCase();
}

/** Reverse lookup: the channel that owns an RTC room code (case-insensitive). */
export function meetChannelIdForRoom(
  channels: readonly Pick<MeetChannel, "id" | "kind" | "guestRoomCode">[],
  roomCode: string | null | undefined,
): string | null {
  const needle = roomCode?.trim().toLowerCase();
  if (!needle) return null;
  const match = channels.find((channel) => meetChannelRoomId(channel) === needle);
  return match?.id ?? null;
}

/**
 * Guest in-channel chat must use the same collection id the host Meet
 * workspace selected (`chat-{slug}` / meeting id), not a leftover public
 * slug or a Storybook `"guest"` fallback.
 */
export function meetGuestChatChannelId(input: {
  channels?: readonly Pick<MeetChannel, "id" | "kind" | "guestRoomCode">[] | null;
  invitedRoom?: string | null;
  channelId?: string | null;
  meetingId?: string | null;
}): string {
  const channels = input.channels ?? [];
  const room = input.invitedRoom?.trim() || null;
  const fromRoom = meetChannelIdForRoom(channels, room);
  if (fromRoom) return fromRoom;
  const routeId = input.channelId?.trim() || input.meetingId?.trim() || room;
  if (!routeId) return "guest";
  if (/^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/i.test(routeId)) {
    return routeId.toLowerCase();
  }
  return meetCollectionIdFromPublic(routeId);
}
