import type { WgwMeetRoomStatusResponse } from "@/lib/api/wgw/types";

export const MEET_AD_HOC_RESERVATION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type MeetInviteProbeState =
  | "checking"
  | "active"
  | "missing"
  | "waiting-for-host"
  | "error";

export function meetRoomStatusAllowsHost(status: WgwMeetRoomStatusResponse): boolean {
  return typeof status.ownerPrincipal === "string" && status.ownerPrincipal.length > 0;
}

export function meetInviteStateFromRoomStatus(
  status: WgwMeetRoomStatusResponse,
  options: { canHost: boolean },
): Exclude<MeetInviteProbeState, "checking" | "error"> {
  if (!status.reserved) {
    return "missing";
  }
  if (options.canHost) {
    return "active";
  }
  if (!status.active) {
    return "waiting-for-host";
  }
  return "active";
}

export function meetActorPrincipal(username: string): string {
  return `u:${username.trim().toLowerCase()}`;
}
