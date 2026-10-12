import { getPrincipalLinkRegistry } from "@/lib/rtc/session/principal-link-registry";
import type { RtcPeerDescriptor } from "@/lib/rtc/types";

/**
 * Presence envelope. `v` is the mesh version every other kind already carries;
 * the hint itself is `{kind, room}` as the call asks for.
 */
export type MeetJoinHintEnvelope = { v: 1; kind: "meet-join-hint"; room: string };

export function meetJoinHintEnvelope(room: string): MeetJoinHintEnvelope {
  return { v: 1, kind: "meet-join-hint", room };
}

export function isMeetJoinHint(value: unknown): value is MeetJoinHintEnvelope {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    row.v === 1 && row.kind === "meet-join-hint" && typeof row.room === "string" && row.room !== ""
  );
}

/**
 * After a Meet join, tell principal peers whose user is on the Meet roster to
 * poll now. Guests have no principal mesh; this sends nothing for them.
 */
export function announceMeetJoin(room: string, roster: readonly RtcPeerDescriptor[]): void {
  const registry = getPrincipalLinkRegistry();
  const users = new Set<string>();
  for (const peer of roster) {
    if (peer.user) users.add(peer.user);
  }
  const hint = meetJoinHintEnvelope(room);
  for (const user of users) {
    registry.sendToUsername(user, hint);
  }
}
