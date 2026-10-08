import { isRtcDebugEnabled } from "@/lib/rtc/debug";
import {
  isLinkDownHint,
  LINK_DOWN_TYPE,
  type LinkObservation,
} from "@/lib/rtc/link/link-supervisor";
import { LinkSupervisor, subscribeNetworkChange } from "@/lib/rtc/link/link-supervisor-runtime";
import { rtcLog } from "@/lib/rtc/log";
import { createDataBinding } from "@/lib/rtc/session/bindings";
import { parseCollabReuseEnvelope } from "@/lib/rtc/session/collab-reuse-envelope";
import { createRtcSession } from "@/lib/rtc/session/create-rtc-session";
import type { RtcPeerMesh } from "@/lib/rtc/session/peer-mesh";
import {
  getPrincipalLinkRegistry,
  type PrincipalLinkRegistry,
} from "@/lib/rtc/session/principal-link-registry";
import type { RtcPeerDescriptor, RtcPollIntervals, RtcSettings } from "@/lib/rtc/types";
import { parsePresenceEnvelope } from "@/presence-core/src/presence-envelope";
import type {
  PresenceEnvelope,
  PresenceMeshEvent,
  PresenceMeshSession,
} from "@/presence-core/src/presence-types";

const DC_LABEL = "presence";

/** Fast cadence while data channels are still being established. */
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

export type PresenceRtcSessionOptions = {
  room: string;
  rtcSettings: RtcSettings;
  /** Injected in tests; the live app publishes into the suite-level singleton. */
  linkRegistry?: PrincipalLinkRegistry;
};

/**
 * Principal-room mesh wrapper: one `RtcPeerMesh` on channel `principal` with a
 * data binding. `RtcPeerMesh` reads `pollIntervals` live on every schedule, so the
 * session owns a mutable intervals object and adapts `steadyMs` to DC topology
 * (fast while connecting, slow once the mesh is fully linked).
 */
export class PresenceRtcSession implements PresenceMeshSession {
  private readonly listeners = new Set<(event: PresenceMeshEvent) => void>();

  private readonly mesh: RtcPeerMesh;

  private readonly registry: PrincipalLinkRegistry;

  private readonly supervisor: LinkSupervisor;

  private unsubscribeNetwork: () => void = () => undefined;

  private readonly pollIntervals: RtcPollIntervals = {
    connectingMs: 400,
    steadyMs: ACTIVE_STEADY_POLL_MS,
  };

  constructor(options: PresenceRtcSessionOptions) {
    this.registry = options.linkRegistry ?? getPrincipalLinkRegistry();
    const binding = createDataBinding({
      label: DC_LABEL,
      onOpen: (remoteId) => {
        rtcLog({ channel: "principal", peerId: this.mesh.getMyId() }, "dc-open", { remoteId });
        this.syncPrincipalLinks();
        this.updatePollCadence();
        this.emit({ type: "dc-open", peerId: remoteId });
      },
      onMessage: (remoteId, data) => {
        const reuse = parseCollabReuseEnvelope(data);
        if (reuse) {
          const username = this.mesh.getRoomPeers().find((peer) => peer.id === remoteId)?.user;
          if (username) this.registry.receive(username, remoteId, reuse);
          return;
        }
        const envelope = parsePresenceEnvelope(data);
        if (envelope) this.emit({ type: "envelope", peerId: remoteId, envelope });
      },
      onClose: () => {
        this.syncPrincipalLinks();
        this.updatePollCadence();
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
        this.syncPrincipalLinks();
        this.updatePollCadence();
        this.emit({ type: "roster" });
      },
      onSendFailed: (principalPeerId) => this.registry.markSendFailed(principalPeerId),
      onPollData: (data) => {
        this.receiveLinkHints(data.messages);
        this.syncPrincipalLinks();
        this.updatePollCadence();
        this.emit({ type: "roster" });
      },
    });
    this.supervisor = new LinkSupervisor({
      now: () => Date.now(),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      isInitiator: (peerId) => this.mesh.isInitiatorFor(peerId),
      dial: (peerId) => {
        this.mesh.abortPeerConnection(peerId);
        this.mesh.retryPeerConnection(peerId);
      },
      sendHint: (peerId, hint) => {
        void this.mesh.sendMailbox(peerId, LINK_DOWN_TYPE, hint).catch(() => undefined);
      },
      log: (event, details) =>
        rtcLog({ channel: "principal", peerId: this.mesh.getMyId() }, event, details),
    });
    this.installDebugHook();
  }

  private observeLink(peerId: string): LinkObservation {
    if (this.mesh.getDataChannel(peerId)?.readyState === "open") return "open";
    const pc = this.mesh.getPeerConnection(peerId);
    if (!pc) return "absent";
    if (pc.connectionState === "failed" || pc.connectionState === "closed") return "failed";
    return "connecting";
  }

  private superviseLinks(): void {
    const myId = this.mesh.getMyId();
    if (!myId) return;
    const peers = this.mesh.getRoomPeers().filter((peer) => peer.id !== myId);
    this.supervisor.roster(peers.map((peer) => peer.id));
    for (const peer of peers) this.supervisor.observe(peer.id, this.observeLink(peer.id));
  }

  private receiveLinkHints(
    messages: readonly { from: string; type: string; payload: unknown }[],
  ): void {
    for (const message of messages) {
      if (message.type === LINK_DOWN_TYPE && isLinkDownHint(message.payload)) {
        this.supervisor.hint(message.from);
      }
    }
  }

  private emit(event: PresenceMeshEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private updatePollCadence(): void {
    const peers = this.mesh.getRoomPeers();
    if (peers.length === 0) {
      this.pollIntervals.steadyMs = ALONE_STEADY_POLL_MS;
      return;
    }
    const allLinked = peers.every(
      (peer) => this.mesh.getDataChannel(peer.id)?.readyState === "open",
    );
    this.pollIntervals.steadyMs = allLinked ? IDLE_STEADY_POLL_MS : ACTIVE_STEADY_POLL_MS;
  }

  onEvent(listener: (event: PresenceMeshEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getRoomPeers(): RtcPeerDescriptor[] {
    return this.mesh.getRoomPeers();
  }

  broadcast(envelope: PresenceEnvelope): void {
    this.mesh.broadcastJson(envelope);
  }

  sendTo(peerId: string, envelope: PresenceEnvelope): void {
    this.mesh.sendJsonTo(peerId, envelope);
  }

  async join(name: string): Promise<{ peerId: string }> {
    const joined = await this.mesh.join({ name });
    this.unsubscribeNetwork = subscribeNetworkChange(() => this.supervisor.networkChange());
    return { peerId: joined.peerId };
  }

  async leave(): Promise<void> {
    this.unsubscribeNetwork();
    this.supervisor.dispose();
    this.registry.retain(new Set());
    await this.mesh.leave();
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
          send: (payload) => this.mesh.sendJsonTo(peer.id, payload),
        });
      } else {
        connectingUsernames.add(peer.user);
      }
    }
    this.registry.retain(live);
    this.registry.setConnectingUsernames(connectingUsernames);
    this.superviseLinks();
  }
}

export function createPresenceRtcSession(options: PresenceRtcSessionOptions): PresenceRtcSession {
  return new PresenceRtcSession(options);
}
