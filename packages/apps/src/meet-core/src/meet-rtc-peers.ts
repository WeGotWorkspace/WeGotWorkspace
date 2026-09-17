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
