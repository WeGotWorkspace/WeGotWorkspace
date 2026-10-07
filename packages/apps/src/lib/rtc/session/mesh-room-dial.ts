import { peerIdentityKey, sortPrincipalDialPeers } from "@/lib/rtc/session/stale-identity-peers";
import type { RtcLinkState, RtcPeerDescriptor } from "@/lib/rtc/types";

/**
 * Roster dialing and peer-hint connects. Kept off `RtcPeerMesh` so that file
 * stays under the 800-line ceiling.
 */

/** Limit how many new principal dials start on a single poll (ghost roster protection). */
const PRINCIPAL_MAX_NEW_CONNECTS_PER_POLL = 3;

export type MeshRoomDial = {
  myId: string | null;
  principal: boolean;
  roomPeers: RtcPeerDescriptor[];
  droppedGhostIds: Set<string>;
  hasPeer: (id: string) => boolean;
  peerIds: () => string[];
  linkStateOf: (id: string) => RtcLinkState | null;
  shouldConnectToPeer?: (peer: RtcPeerDescriptor) => boolean;
  isInitiator: (id: string) => boolean;
  rtcSignalsEnabled: () => boolean;
  allowNameFallback: boolean;
  /** Store caps before the connect filter, including peers this poll will not dial. */
  rememberCaps: (id: string, caps: RtcPeerDescriptor["caps"]) => void;
  connectTo: (id: string, name: string) => Promise<void>;
  log: (event: string, details?: unknown) => void;
  kickPoll: () => void;
  notifyLinkChange: () => void;
};

function skipUnlessConnectable(dial: MeshRoomDial, peer: RtcPeerDescriptor): boolean {
  if (dial.shouldConnectToPeer && !dial.shouldConnectToPeer(peer)) {
    dial.log("peer-skipped", { remoteId: peer.id, reason: "should-connect-false" });
    return true;
  }
  return false;
}

function connectPeer(dial: MeshRoomDial, peer: RtcPeerDescriptor): void {
  void dial.connectTo(peer.id, peer.name).catch((error: unknown) => {
    dial.log("peer-connect-failed", { remoteId: peer.id, error });
  });
}

/** Dial everyone on the fresh roster, respecting the principal per-poll dial cap. */
export function dialRoomPeers(dial: MeshRoomDial): void {
  let newPrincipalConnects = 0;
  const dialOrder = dial.principal
    ? sortPrincipalDialPeers(dial.roomPeers, dial.peerIds(), dial.droppedGhostIds)
    : dial.roomPeers;
  for (const peer of dialOrder) {
    dial.rememberCaps(peer.id, peer.caps);
    if (skipUnlessConnectable(dial, peer)) continue;
    if (dial.principal && !dial.hasPeer(peer.id)) {
      if (newPrincipalConnects >= PRINCIPAL_MAX_NEW_CONNECTS_PER_POLL) {
        dial.log("peer-skipped", { remoteId: peer.id, reason: "dial-cap" });
        continue;
      }
      newPrincipalConnects += 1;
    }
    connectPeer(dial, peer);
  }
}

/**
 * Re-dial room peers after a collab reuse path ends (principal DC gone /
 * ack timeout). Poll may return 204 while the roster is unchanged, so this
 * must not wait for the next poll cycle.
 */
type RoomPeerRetry = "skipped" | "dialed" | "awaiting";

/** One roster peer: skip if not connectable or already connected; dial or kick poll. */
function retryListedPeer(dial: MeshRoomDial, peer: RtcPeerDescriptor): RoomPeerRetry {
  if (skipUnlessConnectable(dial, peer)) return "skipped";
  if (dial.linkStateOf(peer.id) === "connected") {
    dial.log("peer-skipped", { remoteId: peer.id, reason: "already-connected" });
    return "skipped";
  }
  if (dial.isInitiator(peer.id)) {
    dial.log("reuse-fallback-connect", { remoteId: peer.id });
    connectPeer(dial, peer);
    return "dialed";
  }
  return "awaiting";
}

/**
 * Re-dial one room peer after a collab reuse path ends for that peer.
 * Connected peers are left untouched.
 */
export function retryRoomPeer(dial: MeshRoomDial, remoteId: string): void {
  if (!dial.myId || !dial.rtcSignalsEnabled()) return;
  const peer = dial.roomPeers.find((candidate) => candidate.id === remoteId);
  if (!peer || peer.id === dial.myId) return;
  if (retryListedPeer(dial, peer) === "awaiting") {
    dial.log("reuse-fallback-poll-kick");
    dial.kickPoll();
  }
  dial.notifyLinkChange();
}

export function retryRoomPeerConnections(dial: MeshRoomDial): void {
  if (!dial.myId || !dial.rtcSignalsEnabled()) return;
  let awaitingRemoteOffer = false;
  for (const peer of dial.roomPeers) {
    if (peer.id === dial.myId) continue;
    if (retryListedPeer(dial, peer) === "awaiting") awaitingRemoteOffer = true;
  }
  if (awaitingRemoteOffer) {
    dial.log("reuse-fallback-poll-kick");
    dial.kickPoll();
  }
  dial.notifyLinkChange();
}

/**
 * Gossip hint received from an already-connected peer: another peer joined
 * the room. Dial unknown peers where the local side is the initiator; for
 * the rest, reschedule an immediate poll so their offer is picked up without
 * waiting out the idle poll interval. Purely additive — the roster poll
 * remains the source of truth and a lost hint costs nothing.
 */
export function applyPeerHint(dial: MeshRoomDial, peers: readonly RtcPeerDescriptor[]): void {
  if (!dial.myId || !dial.rtcSignalsEnabled()) return;
  let awaitingRemoteOffer = false;
  const knownIdentities = dial.allowNameFallback
    ? new Set(
        dial.roomPeers
          .map((peer) => peerIdentityKey(peer, true))
          .filter((key): key is string => key !== null),
      )
    : null;
  for (const peer of peers) {
    if (peer.id === dial.myId) {
      dial.log("peer-skipped", { remoteId: peer.id, reason: "self" });
      continue;
    }
    if (dial.droppedGhostIds.has(peer.id) || dial.hasPeer(peer.id)) {
      dial.log("peer-skipped", { remoteId: peer.id, reason: "already-known" });
      continue;
    }
    const identity = knownIdentities ? peerIdentityKey(peer, true) : null;
    if (identity && knownIdentities?.has(identity)) {
      dial.log("peer-skipped", { remoteId: peer.id, reason: "stale-hint-identity" });
      dial.droppedGhostIds.add(peer.id);
      continue;
    }
    if (skipUnlessConnectable(dial, peer)) continue;
    if (dial.isInitiator(peer.id)) {
      dial.log("peer-hint-connect", { remoteId: peer.id });
      connectPeer(dial, peer);
    } else {
      awaitingRemoteOffer = true;
    }
  }
  if (awaitingRemoteOffer) {
    dial.log("peer-hint-poll-kick");
    dial.kickPoll();
  }
}
