import { decodeMeetKnockerName } from "@/meet-core/src/meet-control-messages";
import type { RtcPeerDescriptor } from "@/lib/rtc/types";

/**
 * Meet mesh filter: never ICE to self or a still-knocking peer, and stay
 * quiet while this tab is waiting to be admitted.
 */
export function shouldConnectMeetPeer(
  peer: Pick<RtcPeerDescriptor, "id" | "name">,
  selfId: string | null,
  waitingForAdmission: boolean,
): boolean {
  if (waitingForAdmission) return false;
  if (selfId && peer.id === selfId) return false;
  return decodeMeetKnockerName(peer.name) == null;
}

/**
 * Meet offer gate: answer a roster row that is not knocking, nothing else. The
 * server rejects `offer`, `answer`, and `ice` from the lobby, but a member's
 * client must not lean on that alone — a forged offer, or one that races the
 * roster, is ignored here too. An id the roster does not carry is not a peer.
 */
export function shouldAcceptMeetOffer(roster: ReadonlyMap<string, string>, from: string): boolean {
  const name = roster.get(from);
  if (name === undefined) return false;
  return decodeMeetKnockerName(name) == null;
}
