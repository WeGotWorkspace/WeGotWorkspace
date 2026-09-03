import { isRtcDebugEnabled } from "@/lib/rtc/debug";
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
 * Slow steady state once every rostered peer has an open data channel (or the room
 * is empty): presence/chat/typing flow over the DC, the poll only discovers
 * newcomers, so 20 s keeps every logged-in session cheap.
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
      onPollData: () => {
        this.syncPrincipalLinks();
        this.updatePollCadence();
        this.emit({ type: "roster" });
      },
    });
    this.installDebugHook();
  }

  private emit(event: PresenceMeshEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private updatePollCadence(): void {
    const peers = this.mesh.getRoomPeers();
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
    return { peerId: joined.peerId };
  }

  async leave(): Promise<void> {
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
  }
}

export function createPresenceRtcSession(options: PresenceRtcSessionOptions): PresenceRtcSession {
  return new PresenceRtcSession(options);
}
