import { parseRtcDebugFlag } from "@/lib/rtc/debug";

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

/** True on guest/join routes where the user entered via invite link. */
export function meetIsJoinRoute(pathname: string): boolean {
  return pathname.startsWith("/meet/guest") || pathname.startsWith("/meet/join");
}

/** Host on `/meet` ends the call; guests and join routes leave only. */
export function meetCallExitMode(
  isJoinRoute: boolean,
  hasSignedInIdentity: boolean,
): MeetCallExitMode {
  if (isJoinRoute || !hasSignedInIdentity) return "leave";
  return "end";
}

/** Guest invite URL for sharing (always `/meet/guest?room=` on the given origin). */
export function buildMeetGuestCallLink(
  roomCode: string,
  origin = "https://workspace.example.com",
): string {
  const url = new URL("/meet/guest", origin);
  url.searchParams.set("room", roomCode);
  return url.toString();
}
