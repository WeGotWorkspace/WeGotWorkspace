import { isMeetRoomCode } from "@/calendar-core/src/calendar-meet-link";
import { parseRtcDebugFlag } from "@/lib/rtc/debug";
import { meetCollectionIdFromPublic, meetPublicChannelId } from "@/meet-core/src/meet-public-id";

export type MeetRouteSearch = {
  room?: string;
  /** Number `1` so the serializer emits `rtcDebug=1`, not `rtcDebug="1"`. */
  rtcDebug?: 1;
};

export function parseMeetRouteSearch(search: Record<string, unknown>): MeetRouteSearch {
  const room = typeof search.room === "string" ? search.room : undefined;
  const rtcDebug = parseRtcDebugFlag(search.rtcDebug);
  return {
    ...(room !== undefined ? { room } : {}),
    ...(rtcDebug !== undefined ? { rtcDebug } : {}),
  };
}

export function validateMeetRouteSearch(search: Record<string, unknown>): MeetRouteSearch {
  return parseMeetRouteSearch(search);
}

/** Room id from router search params (`?room=`). */
export function meetRoomFromSearch(search: MeetRouteSearch): string | null {
  const room = search.room?.trim();
  return room && room.length > 0 ? room : null;
}

/** Search params to keep when the room moves into `/meet/meetings/{id}`. */
export function meetSearchWithoutRoom(search: MeetRouteSearch): MeetRouteSearch {
  return search.rtcDebug !== undefined ? { rtcDebug: search.rtcDebug } : {};
}

/** Serialize active room for the current meet route search params. */
export function meetSearchFromRoom(roomCode: string | null): MeetRouteSearch {
  const room = roomCode?.trim();
  const rtcDebug = parseRtcDebugFlag(
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("rtcDebug")
      : undefined,
  );
  const debug = rtcDebug !== undefined ? { rtcDebug } : {};
  if (!room) return { ...debug };
  return { room, ...debug };
}

export type MeetCallExitMode = "end" | "leave";

/**
 * True when this navigation is a `/meet/meetings/{id}` invite (slug or
 * `xxxx-xxxx-xxxx`), `/meet/guest`, `/meet/join`, or leftover `?room=`.
 * `/meet/channels/{id}` stays a workspace path.
 */
export function meetIsJoinRoute(pathname: string, room?: string | null): boolean {
  if (pathname.startsWith("/meet/guest") || pathname.startsWith("/meet/join")) {
    return true;
  }
  if (meetMeetingIdFromPathname(pathname)) return true;
  return /^\/meet\/?$/.test(pathname) && Boolean(room?.trim());
}

/** Path already encodes the public invite id — do not append or honor `?room=`. */
export function meetPathOwnsInviteRoom(pathname: string): boolean {
  return Boolean(meetMeetingIdFromPathname(pathname) || meetChannelIdFromPathname(pathname));
}

/**
 * RTC room encoded by the current Meet URL. `/meet/meetings/{id}` and
 * `/meet/channels/{id}` share one lookup: leftover codes stay as-is;
 * collection slugs map onto `chat-{slug}` (the meeting channel room).
 * When the path owns the id, leftover `?room=` is ignored so the internal
 * collection id never becomes the public URL.
 */
export function meetInvitedRoomFromRoute(input: {
  pathname: string;
  search?: MeetRouteSearch;
  meetingId?: string | null;
  channelId?: string | null;
}): string | null {
  const meetingId = input.meetingId?.trim() || meetMeetingIdFromPathname(input.pathname);
  if (meetingId) {
    return isMeetRoomCode(meetingId) ? meetingId : meetCollectionIdFromPublic(meetingId);
  }
  const channelId = input.channelId?.trim() || meetChannelIdFromPathname(input.pathname);
  if (channelId) return meetCollectionIdFromPublic(channelId);
  return meetRoomFromSearch(input.search ?? {});
}

/** Channel id from `/meet/channels/{id}` (invite and workspace share the path). */
export function meetChannelIdFromPathname(pathname: string): string | null {
  const match = pathname.match(/^\/meet\/channels\/([^/]+)$/);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]).trim() || null;
  } catch {
    return match[1].trim() || null;
  }
}

/** Canonical calendar/Meet invite URL for a chat channel (`/meet/channels/{id}`). */
export function buildMeetChannelInviteLink(
  channelId: string,
  origin = "https://workspace.example.com",
): string {
  const id = meetPublicChannelId(channelId).toLowerCase();
  const url = new URL(`/meet/channels/${encodeURIComponent(id)}`, origin);
  return url.toString();
}

/** Canonical invite URL for a meeting-kind collection (`/meet/meetings/{id}`). */
export function buildMeetMeetingInviteLink(
  meetingId: string,
  origin = "https://workspace.example.com",
): string {
  const id = meetPublicChannelId(meetingId).toLowerCase();
  const url = new URL(`/meet/meetings/${encodeURIComponent(id)}`, origin);
  return url.toString();
}

/** Channel vs meeting path from collection kind. */
export function buildMeetCollectionInviteLink(
  channel: { id: string; kind?: string | null },
  origin = "https://workspace.example.com",
): string {
  if (channel.kind === "meeting") {
    return buildMeetMeetingInviteLink(channel.id, origin);
  }
  return buildMeetChannelInviteLink(channel.id, origin);
}

/** Ad-hoc meeting id from `/meet/meetings/{id}`. */
export function meetMeetingIdFromPathname(pathname: string): string | null {
  const match = pathname.match(/^\/meet\/meetings\/([^/]+)$/);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]).trim() || null;
  } catch {
    return match[1].trim() || null;
  }
}

/** Host on `/meet` ends the call; guests and join routes leave only. */
export function meetCallExitMode(
  isJoinRoute: boolean,
  hasSignedInIdentity: boolean,
): MeetCallExitMode {
  if (isJoinRoute || !hasSignedInIdentity) return "leave";
  return "end";
}

/** Ad-hoc meeting invite URL (`/meet/meetings/{id}` on the given origin). */
export function buildMeetGuestCallLink(
  roomCode: string,
  origin = "https://workspace.example.com",
): string {
  const id = roomCode.trim().toLowerCase();
  const url = new URL(`/meet/meetings/${encodeURIComponent(id)}`, origin);
  return url.toString();
}

/**
 * Copied calendar/Meet invite URL. Chat-channel rooms use `/meet/channels/{id}`;
 * ad-hoc codes use `/meet/meetings/{id}`. One link for members and guests — the
 * destination is chosen from auth, not from a `/guest` path.
 */
export function buildMeetInviteCallLink(
  roomCode: string,
  origin = "https://workspace.example.com",
): string {
  const room = roomCode.trim();
  if (/^chat-[a-z0-9_-]{1,250}$/i.test(room)) {
    return buildMeetChannelInviteLink(room, origin);
  }
  return buildMeetGuestCallLink(room.toLowerCase(), origin);
}
