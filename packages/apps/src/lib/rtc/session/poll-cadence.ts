import type { RtcSessionBinding } from "@/lib/rtc/session/bindings";
import type {
  RtcLinkState,
  RtcPeerDescriptor,
  RtcPollIntervals,
  SignalingChannel,
} from "@/lib/rtc/types";

/**
 * Collab room with nobody reachable on the roster. Empty `.every()` is not
 * "stable". This is also how long a newcomer who is not linked yet waits to be
 * found, so it stays short (#2156).
 */
const COLLAB_ALONE_POLL_INTERVAL_MS = 2_000;
/** Every reachable collab peer already has a data channel. */
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
  /**
   * True while an unlinked peer is still new enough to be dialled at the fast
   * poll (`RosterPeerClock`). Without it every unlinked peer counts as dialling.
   */
  isDialing?: (peerId: string, linkedNow: boolean) => boolean;
  /** A collab peer linked through another channel (collab reuse over the presence mesh). */
  linkedElsewhere?: (peerId: string) => boolean;
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

function isCollabPeerLinked(snapshot: MeshPollCadenceSnapshot, peerId: string): boolean {
  return (
    snapshot.linkStateOf(peerId) === "connected" || snapshot.linkedElsewhere?.(peerId) === true
  );
}

export function hasStableCollabTopology(snapshot: MeshPollCadenceSnapshot): boolean {
  if (!isCollabDataMesh(snapshot)) return false;
  if (snapshot.roomPeers.length === 0) return false;
  return snapshot.roomPeers.every((peer) => isCollabPeerLinked(snapshot, peer.id));
}

/**
 * Collab steady delay. A peer that is being dialled keeps the configured fast
 * cadence; one that did not link within `UNLINKED_PEER_FAST_WINDOW_MS` counts
 * as absent, so a ghost or a browser without WebRTC cannot hold the room at
 * the fast poll (#2156). The HTTP fallback sets its own cap for live peers.
 */
function collabDelayMs(intervals: RtcPollIntervals, snapshot: MeshPollCadenceSnapshot): number {
  let dialing = false;
  let linked = 0;
  for (const peer of snapshot.roomPeers) {
    const isLinked = isCollabPeerLinked(snapshot, peer.id);
    if (isLinked) linked += 1;
    if (snapshot.isDialing ? snapshot.isDialing(peer.id, isLinked) : !isLinked) dialing = true;
  }
  if (dialing) return intervals.steadyMs;
  const idle = linked > 0 ? COLLAB_STABLE_POLL_INTERVAL_MS : COLLAB_ALONE_POLL_INTERVAL_MS;
  return Math.max(intervals.steadyMs, idle);
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
  if (isCollabDataMesh(snapshot)) {
    delay = collabDelayMs(intervals, snapshot);
  } else if (hasStableMeetTopology(snapshot)) {
    delay = Math.max(delay, MEET_IDLE_POLL_INTERVAL_MS);
  }
  if (isHiddenWithoutPeerConnections(snapshot)) {
    delay = Math.max(delay, HIDDEN_IDLE_POLL_INTERVAL_MS);
  }
  if (intervals.maxDelayMs != null) delay = Math.min(delay, intervals.maxDelayMs);
  return delay;
}
