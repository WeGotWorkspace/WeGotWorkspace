import { parseMeetInvitePath } from "@/calendar-core/src/calendar-meet-link";
import { meetUpcomingJoinTarget } from "@/meet-core/src/meet-calendar-meeting";
import { meetChannelIdForRoom } from "@/meet-core/src/meet-channel-room";
import { meetIsAdHocMeetingId } from "@/meet-core/src/meet-chat-route";
import type { MeetChannel } from "@/meet-core/src/meet-types";

type MeetJoinChannel = Pick<MeetChannel, "id" | "kind" | "guestRoomCode">;

/**
 * What a signed-in Meet user should do with an invite. Ad-hoc room codes enter
 * that room. They never mint a second meeting.
 */
export type MeetSignedInJoinAction =
  | { action: "start-call"; channelId: string }
  | { action: "join-room"; room: string }
  | { action: "select-channel"; channelId: string }
  | { action: "ignore" };

/** `/meet/meetings/{id}` while signed in. Only `xxxx-xxxx-xxxx` auto-joins. */
export function meetSignedInMeetingRouteJoin(
  meetingId: string | null | undefined,
  channels: readonly MeetJoinChannel[],
): MeetSignedInJoinAction {
  const id = meetingId?.trim().toLowerCase() ?? "";
  if (!meetIsAdHocMeetingId(id)) return { action: "ignore" };
  const channelId = meetChannelIdForRoom(channels, id);
  if (channelId) return { action: "start-call", channelId };
  return { action: "join-room", room: id };
}

/**
 * Upcoming-row click. A room-code href joins that room (the channel that
 * already owns the code, or the code itself). Channel paths only select.
 */
export function meetSignedInUpcomingJoin(
  href: string,
  workspaceOrigin: string,
  channels: readonly MeetJoinChannel[],
): MeetSignedInJoinAction {
  const target = meetUpcomingJoinTarget(href, workspaceOrigin, channels);
  if (!target || target.kind === "external") return { action: "ignore" };
  if (target.kind === "room") return { action: "join-room", room: target.room };
  const invite = parseMeetInvitePath(href);
  if (invite?.roomKind === "code") {
    return { action: "start-call", channelId: target.channelId };
  }
  return { action: "select-channel", channelId: target.channelId };
}
