import { isRtcDebugEnabled } from "@/lib/rtc/debug";
import { rtcLog } from "@/lib/rtc/log";
import { createDataBinding } from "@/lib/rtc/session/bindings";
import {
  attachReusePayload,
  parseCollabReuseEnvelope,
} from "@/lib/rtc/session/collab-reuse-envelope";
import { createRtcSession } from "@/lib/rtc/session/create-rtc-session";
import type { RtcPeerMesh } from "@/lib/rtc/session/peer-mesh";
import { RosterPeerClock } from "@/lib/rtc/session/roster-peer-clock";
import {
  getPrincipalLinkRegistry,
  type PrincipalLinkRegistry,
} from "@/lib/rtc/session/principal-link-registry";
import { HttpSignalingError } from "@/lib/rtc/signaling/http-client";
import type { RtcPeerDescriptor, RtcPollIntervals, RtcSettings } from "@/lib/rtc/types";
import { parsePresenceEnvelope } from "@/presence-core/src/presence-envelope";
import type {
  PresenceEnvelope,
  PresenceMeshEvent,
  PresenceMeshSession,
} from "@/presence-core/src/presence-types";

const DC_LABEL = "presence";

/**
 * Fast cadence while data channels are still being established. A peer that
 * has not linked after `UNLINKED_PEER_FAST_WINDOW_MS` no longer counts, so a
 * ghost or a browser without WebRTC cannot keep the room here (#2156).
 */
const ACTIVE_STEADY_POLL_MS = 1200;

/**
 * Alone in the principal room. An empty roster must not take the linked-mesh
 * interval: `[].every()` is true, and that used to park the poll at 20 s.
 */
const ALONE_STEADY_POLL_MS = 4_000;

/**
 * Slow steady state once every rostered peer has an open data channel.
 * Presence, chat, and typing flow over the data channel; the poll only
 * discovers newcomers.
 */
const IDLE_STEADY_POLL_MS = 20000;

/** What one presence session writes into the suite-level principal link registry. */
export type PrincipalLinkSink = Pick<
  PrincipalLinkRegistry,
  | "registerLink"
  | "retain"
  | "setConnectingUsernames"
  | "setPrincipalPoller"
  | "receive"
  | "markSendFailed"
>;

export type PresenceRtcSessionOptions = {
  room: string;
  rtcSettings: RtcSettings;
  /**
   * Injected in tests. The live app passes one Team room's share of the
   * suite-level registry (`TeamPrincipalLinks`), or the singleton itself.
   */
  linkRegistry?: PrincipalLinkSink;
  /** The server refused this room (403): the user left the Team (#1921). */
  onRefused?: () => void;
};

/**
 * Principal-room mesh wrapper: one `RtcPeerMesh` on channel `principal` with a
 * data binding. `RtcPeerMesh` reads `pollIntervals` live on every schedule, so
 * `steadyMs` is a getter over DC topology (fast while a peer is being dialled,
 * slow once every reachable peer is linked).
 */
export class PresenceRtcSession implements PresenceMeshSession {
  private readonly listeners = new Set<(event: PresenceMeshEvent) => void>();

  private readonly mesh: RtcPeerMesh;

  private readonly registry: PrincipalLinkSink;

  /** Stretches the slow steady polls when a user has several Team rooms (#1921). */
  private steadyScale = 1;

  readonly room: string;

  private readonly rosterClock = new RosterPeerClock();

  private readonly pollIntervals: RtcPollIntervals;

  constructor(options: PresenceRtcSessionOptions) {
    const steadyPollMs = () => this.steadyPollMs();
    this.pollIntervals = {
      connectingMs: 400,
      get steadyMs() {
        return steadyPollMs();
      },
    };
    this.room = options.room;
    this.registry = options.linkRegistry ?? getPrincipalLinkRegistry();
    const binding = createDataBinding({
      label: DC_LABEL,
      onOpen: (remoteId) => {
        rtcLog({ channel: "principal", peerId: this.mesh.getMyId() }, "dc-open", { remoteId });
        this.syncPrincipalLinks();
        this.emit({ type: "dc-open", peerId: remoteId });
      },
      onMessage: (remoteId, json, payload) => {
        const reuse = parseCollabReuseEnvelope(json);
        if (reuse) {
          const username = this.mesh.getRoomPeers().find((peer) => peer.id === remoteId)?.user;
          if (username)
            this.registry.receive(username, remoteId, attachReusePayload(reuse, payload));
          return;
        }
        const envelope = parsePresenceEnvelope(json);
        if (envelope) this.emit({ type: "envelope", peerId: remoteId, envelope });
      },
      onClose: () => {
        this.noteLinkChange();
        this.syncPrincipalLinks();
        this.emit({ type: "roster" });
      },
    });

    this.mesh = createRtcSession({
      channel: "principal",
      room: options.room,
      rtcSettings: options.rtcSettings,
      binding,
      pollIntervals: this.pollIntervals,
      signaling: {
        sendFromField: "peerId",
      },
      onLinkChange: () => {
        this.noteLinkChange();
        this.syncPrincipalLinks();
        this.emit({ type: "roster" });
      },
      onSendFailed: (principalPeerId) => this.registry.markSendFailed(principalPeerId),
      onPollError: (error) => {
        if (error instanceof HttpSignalingError && error.status === 403) options.onRefused?.();
      },
      onPollData: (data) => {
        this.rosterClock.noteRoster(data.peers.map((peer) => peer.id));
        this.syncPrincipalLinks();
        this.emit({ type: "roster" });
      },
    });
    this.installDebugHook();
  }

  private emit(event: PresenceMeshEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  /** A dropped link polls at once and keeps the fast cadence for the dial window. */
  private noteLinkChange(): void {
    const ids = this.mesh.getRoomPeers().map((peer) => peer.id);
    if (this.rosterClock.noteLinks(ids, (id) => this.isLinked(id))) this.mesh.kickPoll();
  }

  private steadyPollMs(): number {
    let dialing = false;
    let linked = 0;
    for (const peer of this.mesh.getRoomPeers()) {
      const isLinked = this.isLinked(peer.id);
      if (isLinked) linked += 1;
      if (this.rosterClock.isDialing(peer.id, isLinked)) dialing = true;
    }
    // Only the two slow states stretch: a peer that is still being dialled keeps the fast cadence.
    if (dialing) return ACTIVE_STEADY_POLL_MS;
    return (linked > 0 ? IDLE_STEADY_POLL_MS : ALONE_STEADY_POLL_MS) * this.steadyScale;
  }

  /**
   * A user in N Team rooms polls each of them. The composite session sets
   * `max(1, N / 2)` here, so all rooms together poll at most twice as often
   * as one room (#1921 load check).
   */
  setSteadyScale(scale: number): void {
    this.steadyScale = Math.max(1, scale);
  }

  /** This tab's peer id in the room, once joined. Used for the leave beacon. */
  ownPeers(): { room: string; peerId: string }[] {
    const peerId = this.mesh.getMyId();
    return peerId ? [{ room: this.room, peerId }] : [];
  }

  onEvent(listener: (event: PresenceMeshEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getRoomPeers(): RtcPeerDescriptor[] {
    return this.mesh.getRoomPeers();
  }

  isLinked(peerId: string): boolean {
    return this.mesh.getDataChannel(peerId)?.readyState === "open";
  }

  broadcast(envelope: PresenceEnvelope): void {
    this.mesh.broadcastJson(envelope);
  }

  sendTo(peerId: string, envelope: PresenceEnvelope): void {
    this.mesh.sendJsonTo(peerId, envelope);
  }

  async join(name: string): Promise<{ peerId: string; superseded?: true }> {
    this.registry.setPrincipalPoller(() => this.mesh.kickPoll());
    const joined = await this.mesh.join({ name });
    if (joined.superseded) return { peerId: "", superseded: true };
    return { peerId: joined.peerId };
  }

  async leave(): Promise<void> {
    this.registry.setPrincipalPoller(null);
    this.registry.retain(new Set());
    await this.mesh.leave();
    this.rosterClock.reset();
  }

  private installDebugHook(): void {
    if (typeof window === "undefined" || !isRtcDebugEnabled()) return;
    const debugWindow = window as Window & { __wgwDropPrincipalLinks?: () => number };
    debugWindow.__wgwDropPrincipalLinks = () => {
      let closed = 0;
      for (const peer of this.mesh.getRoomPeers()) {
        const dataChannel = this.mesh.getDataChannel(peer.id);
        if (dataChannel && dataChannel.readyState !== "closed") {
          dataChannel.close();
          closed += 1;
        }
        const peerConnection = this.mesh.getPeerConnection(peer.id);
        if (peerConnection && peerConnection.connectionState !== "closed") {
          peerConnection.close();
          closed += 1;
        }
      }
      this.syncPrincipalLinks();
      rtcLog({ channel: "principal", peerId: this.mesh.getMyId() }, "debug-drop-principal-links", {
        closed,
      });
      return closed;
    };
  }

  private syncPrincipalLinks(): void {
    const live = new Set<string>();
    const connectingUsernames = new Set<string>();
    const myId = this.mesh.getMyId();
    for (const peer of this.mesh.getRoomPeers()) {
      if (!peer.user || peer.id === myId) continue;
      if (this.mesh.getDataChannel(peer.id)?.readyState === "open") {
        live.add(peer.id);
        this.registry.registerLink({
          username: peer.user,
          principalPeerId: peer.id,
          send: (payload, bytes) => {
            if (bytes) this.mesh.sendJsonTo(peer.id, payload, bytes);
            else this.mesh.sendJsonTo(peer.id, payload);
          },
        });
      } else {
        connectingUsernames.add(peer.user);
      }
    }
    this.registry.retain(live);
    this.registry.setConnectingUsernames(connectingUsernames);
  }
}

export function createPresenceRtcSession(options: PresenceRtcSessionOptions): PresenceRtcSession {
  return new PresenceRtcSession(options);
}
