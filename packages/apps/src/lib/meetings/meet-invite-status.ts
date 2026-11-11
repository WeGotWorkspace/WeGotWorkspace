import type { WgwMeetRoomStatusResponse } from "@/lib/api/wgw/types";

export const MEET_AD_HOC_RESERVATION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type MeetInviteProbeState = "checking" | "active" | "missing" | "waiting-for-host" | "error";

/** Manager GET body includes ownerPrincipal and/or createdBy; guests get neither. */
export function meetRoomStatusAllowsHost(status: WgwMeetRoomStatusResponse): boolean {
  return (
    (typeof status.ownerPrincipal === "string" && status.ownerPrincipal.length > 0) ||
    (typeof status.createdBy === "string" && status.createdBy.length > 0)
  );
}

export function meetInviteStateFromRoomStatus(
  status: WgwMeetRoomStatusResponse,
  _options: { canHost: boolean },
): Exclude<MeetInviteProbeState, "checking" | "error"> {
  if (!status.reserved) {
    return "missing";
  }
  // Valid invite (reserved room code or meeting collection) opens the lobby
  // even when nobody is in the call yet. Hosts use canStartReservedRoom.
  return "active";
}

export function meetActorPrincipal(username: string): string {
  return `u:${username.trim().toLowerCase()}`;
}
