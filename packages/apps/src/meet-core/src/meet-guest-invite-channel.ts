import { meetChannelIdForRoom } from "@/meet-core/src/meet-channel-room";
import type { MeetChannel, MeetChannelKind } from "@/meet-core/src/meet-types";

export type MeetGuestInviteChannel = Pick<MeetChannel, "name" | "kind" | "topic">;

/**
 * Resolve the invite card's channel/meeting name + topic from bootstrap data
 * or the public route id (`/meet/channels/{id}` / `/meet/meetings/{id}`).
 */
export function meetGuestInviteChannel(input: {
  channels?: readonly MeetChannel[] | null;
  invitedRoom?: string | null;
  channelId?: string | null;
  meetingId?: string | null;
  fallbackName: string;
}): MeetGuestInviteChannel {
  const channels = input.channels ?? [];
  const roomChannelId = meetChannelIdForRoom(channels, input.invitedRoom);
  const routeId = input.channelId?.trim() || input.meetingId?.trim() || null;
  const match =
    channels.find((channel) => channel.id === roomChannelId) ??
    channels.find((channel) => channel.id === routeId) ??
    channels.find(
      (channel) => routeId != null && channel.name.toLowerCase() === routeId.toLowerCase(),
    );
  if (match) {
    return { name: match.name, kind: match.kind, topic: match.topic };
  }
  if (routeId) {
    const kind: MeetChannelKind = input.channelId?.trim() ? "channel" : "meeting";
    return { name: routeId, kind, topic: null };
  }
  return { name: input.fallbackName, kind: "meeting", topic: null };
}
