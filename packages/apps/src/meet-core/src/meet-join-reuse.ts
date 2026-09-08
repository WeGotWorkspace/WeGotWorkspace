import type { MeetCallStatus } from "@/meet-core/src/meet-call-types";

const ENGAGED_STATUSES: ReadonlySet<MeetCallStatus> = new Set(["preparing", "in-call", "waiting"]);

export function meetJoinIsEngaged(status: MeetCallStatus | null | undefined): boolean {
  return status != null && ENGAGED_STATUSES.has(status);
}

/**
 * A second Start / Strict-mode remount / overlapping `startCall` must not mint
 * another signaling peer in the same room — that leftover shows up as a
 * "remote" and loops the local mic.
 */
export function meetJoinAlreadyEngaged(
  status: MeetCallStatus | null | undefined,
  currentRoom: string | null | undefined,
  targetRoom: string,
): boolean {
  const target = targetRoom.trim().toLowerCase();
  const current = currentRoom?.trim().toLowerCase() ?? "";
  if (!target || current !== target) return false;
  return meetJoinIsEngaged(status);
}
