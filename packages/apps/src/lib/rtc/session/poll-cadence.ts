import type { RtcSessionBinding } from "@/lib/rtc/session/bindings";
import type {
  RtcLinkState,
  RtcPeerDescriptor,
  RtcPollIntervals,
  SignalingChannel,
} from "@/lib/rtc/types";

/** Collab room with nobody else on the roster. Empty `.every()` is not "stable". */
const COLLAB_ALONE_POLL_INTERVAL_MS = 2_000;
/** Every rostered collab peer already has a data channel. */
const COLLAB_STABLE_POLL_INTERVAL_MS = 5_000;
/** Meet idle backoff when connected with no knockers — shorter than collab for chat/control UX. */
const MEET_IDLE_POLL_INTERVAL_MS = 4000;
/** Hidden-tab backoff — applies only when the mesh holds no peer connections at all. */
const HIDDEN_IDLE_POLL_INTERVAL_MS = 60000;
/** Encoded knocker roster names — keep fast poll while guests wait for admit. */
const MEET_KNOCK_ROSTER_PREFIX = "__wgw_knock__:";

/** Everything the idle backoff ladder reads, so the decision stays a pure function. */
export type MeshPollCadenceSnapshot = {
  channel: SignalingChannel;
  bindingKind: RtcSessionBinding["kind"] | null;
  rtcSignalsEnabled: boolean;
  roomPeers: readonly RtcPeerDescriptor[];
  linkStateOf: (peerId: string) => RtcLinkState | null;
  hidden: boolean;
  peerConnectionCount: number;
};

function allPeersConnected(
  peers: readonly RtcPeerDescriptor[],
  linkStateOf: MeshPollCadenceSnapshot["linkStateOf"],
): boolean {
  return peers.every((peer) => linkStateOf(peer.id) === "connected");
}

function isCollabDataMesh(snapshot: MeshPollCadenceSnapshot): boolean {
  return (
    snapshot.channel === "collab" && snapshot.bindingKind === "data" && snapshot.rtcSignalsEnabled
  );
}

export function hasStableCollabTopology(snapshot: MeshPollCadenceSnapshot): boolean {
  if (!isCollabDataMesh(snapshot)) return false;
  if (snapshot.roomPeers.length === 0) return false;
  return allPeersConnected(snapshot.roomPeers, snapshot.linkStateOf);
}

export function hasKnockersInRoster(peers: readonly RtcPeerDescriptor[]): boolean {
  return peers.some((peer) => peer.name.startsWith(MEET_KNOCK_ROSTER_PREFIX));
}

export function hasStableMeetTopology(snapshot: MeshPollCadenceSnapshot): boolean {
  if (snapshot.channel !== "meet" || snapshot.bindingKind !== "media") return false;
  if (!snapshot.rtcSignalsEnabled) return false;
  if (hasKnockersInRoster(snapshot.roomPeers)) return false;
  const activePeers = snapshot.roomPeers.filter(
    (peer) => !peer.name.startsWith(MEET_KNOCK_ROSTER_PREFIX),
  );
  return allPeersConnected(activePeers, snapshot.linkStateOf);
}

/** Hidden-tab backoff only applies to meshes without any peer connections. */
function isHiddenWithoutPeerConnections(snapshot: MeshPollCadenceSnapshot): boolean {
  return snapshot.hidden && snapshot.peerConnectionCount === 0;
}

/**
 * Delay before the next steady-state poll: the configured cadence, stretched by
 * whichever idle backoff the mesh currently qualifies for.
 */
export function steadyPollDelayMs(
  intervals: RtcPollIntervals,
  snapshot: MeshPollCadenceSnapshot,
): number {
  let delay = intervals.steadyMs;
  if (isCollabDataMesh(snapshot) && snapshot.roomPeers.length === 0) {
    delay = Math.max(delay, COLLAB_ALONE_POLL_INTERVAL_MS);
  } else if (hasStableCollabTopology(snapshot)) {
    delay = Math.max(delay, COLLAB_STABLE_POLL_INTERVAL_MS);
  } else if (hasStableMeetTopology(snapshot)) {
    delay = Math.max(delay, MEET_IDLE_POLL_INTERVAL_MS);
  }
  if (isHiddenWithoutPeerConnections(snapshot)) {
    delay = Math.max(delay, HIDDEN_IDLE_POLL_INTERVAL_MS);
  }
  if (intervals.maxDelayMs != null) delay = Math.min(delay, intervals.maxDelayMs);
  return delay;
}
