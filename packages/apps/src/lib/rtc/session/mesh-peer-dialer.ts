import { toRtcConfig } from "@/lib/rtc/config";
import { rtcSdpMeta } from "@/lib/rtc/log";
import type { RtcSessionBinding } from "@/lib/rtc/session/bindings";
import type { MeshPeerEntry, MeshPeerRegistry } from "@/lib/rtc/session/mesh-peer-registry";
import { logSelectedPairTelemetry } from "@/lib/rtc/telemetry/selected-pair";
import type { IceMode, RtcSettings, SignalingChannel, TurnCredentials } from "@/lib/rtc/types";

/** What the dialer needs from the mesh that owns the peer registry. */
export type MeshPeerDialerContext = {
  channel: SignalingChannel;
  rtcSettings: RtcSettings;
  binding?: RtcSessionBinding;
  iceCandidatePoolSize?: number;
  peers: MeshPeerRegistry;
  createPeerConnection: (config: RTCConfiguration) => RTCPeerConnection;
  localPeerId: () => string | null;
  isInitiator: (remoteId: string) => boolean;
  log: (event: string, details?: unknown) => void;
  formatOutbound: (description: RTCSessionDescriptionInit) => RTCSessionDescriptionInit;
  sendSignal: (to: string, type: string, payload: unknown) => Promise<void>;
  onRemoteSignalError: (remoteId: string, error: unknown) => void;
  removePeer: (remoteId: string) => void;
  wirePeerConnection: (remoteId: string, entry: MeshPeerEntry) => void;
};

/**
 * Brings peer connections up: the ICE transport mode, the `RTCPeerConnection`
 * itself, the media or data binding, whether an existing entry can be reused,
 * the outbound offer, and the one-shot relay retry after a failed direct link.
 */
export class MeshPeerDialer {
  private readonly turnConfigured: boolean;

  private turn: TurnCredentials | null = null;

  constructor(private readonly context: MeshPeerDialerContext) {
    this.turnConfigured = context.rtcSettings.turnAvailable;
  }

  /** Credentials from a relay request, applied to peer connections created after this. */
  setTurn(turn: TurnCredentials | null): void {
    this.turn = turn;
  }

  /** `relay` only when the settings force it and TURN is actually configured. */
  initialMode(): IceMode {
    return this.context.rtcSettings.forceRelay && this.turnConfigured ? "relay" : "direct";
  }

  /** Create, register, wire, and bind a peer connection for `remoteId`. */
  createEntry(
    remoteId: string,
    remoteName: string,
    initiator: boolean,
    forcedMode?: IceMode,
  ): MeshPeerEntry {
    const mode = forcedMode ?? this.initialMode();
    const pc = this.makePc(remoteId, mode);
    const entry: MeshPeerEntry = {
      name: remoteName,
      pc,
      mode,
      relayFallbackTried: mode === "relay",
      initiator,
      pendingIce: [],
      signalSent: false,
      dataChannel: null,
    };
    this.context.peers.add(remoteId, entry);
    this.context.wirePeerConnection(remoteId, entry);
    this.attachBinding(remoteId, pc, initiator);
    return entry;
  }

  async connectTo(remoteId: string, remoteName: string, forcedMode?: IceMode): Promise<void> {
    const myId = this.context.localPeerId();
    if (!myId || remoteId === myId) return;
    const initiator = this.context.isInitiator(remoteId);
    if (this.shouldReusePeerEntry(remoteId, initiator)) return;
    if (this.context.peers.has(remoteId)) this.context.removePeer(remoteId);

    const entry = this.createEntry(remoteId, remoteName, initiator, forcedMode);
    this.context.log("peer-connect-start", {
      remoteId,
      remoteName,
      initiator,
      mode: entry.mode,
    });
    if (!initiator) return;

    const { pc } = entry;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(this.context.formatOutbound(offer));
    try {
      await this.context.sendSignal(remoteId, "offer", pc.localDescription);
    } catch (error) {
      this.context.onRemoteSignalError(remoteId, error);
      throw error;
    }
    entry.signalSent = true;
    this.context.log("offer-sent", { remoteId, ...rtcSdpMeta(pc.localDescription) });
  }

  /**
   * Re-dial a failed direct link over TURN with an ICE restart. Once per peer,
   * and only from the initiator side — the answerer waits for the new offer.
   */
  async restartWithRelay(remoteId: string, entry: MeshPeerEntry): Promise<boolean> {
    if (
      !entry.initiator ||
      entry.mode === "relay" ||
      entry.relayFallbackTried ||
      !this.turnConfigured
    ) {
      return false;
    }
    entry.relayFallbackTried = true;
    this.context.log("relay-fallback-start", { remoteId, initiator: entry.initiator });
    try {
      this.context.removePeer(remoteId);
      await this.connectTo(remoteId, entry.name, "relay");
      const next = this.context.peers.get(remoteId);
      if (!next?.initiator) return false;
      const offer = await next.pc.createOffer({ iceRestart: true });
      await next.pc.setLocalDescription(this.context.formatOutbound(offer));
      await this.context.sendSignal(remoteId, "offer", next.pc.localDescription);
      next.signalSent = true;
      this.context.log("relay-fallback-offer-sent", { remoteId });
      void logSelectedPairTelemetry(
        this.context.channel,
        this.context.localPeerId(),
        remoteId,
        next.pc,
        "relay-fallback",
      );
      return true;
    } catch (error) {
      this.context.log("relay-fallback-failed", { remoteId, error });
      return false;
    }
  }

  /** Keep a live link instead of renegotiating; drop failed ones so the dial proceeds. */
  private shouldReusePeerEntry(remoteId: string, initiator: boolean): boolean {
    const entry = this.context.peers.get(remoteId);
    if (!entry) return false;
    if (entry.pc.connectionState === "failed" || entry.pc.iceConnectionState === "failed") {
      this.context.removePeer(remoteId);
      return false;
    }
    const bindingKind = this.context.binding?.kind;
    if (bindingKind === "data" && entry.dataChannel?.readyState === "open") return true;
    if (bindingKind === "media" && entry.pc.connectionState === "connected") return true;
    if (!initiator) return true;
    return entry.signalSent;
  }

  private makePc(remoteId: string, mode: IceMode): RTCPeerConnection {
    const config = toRtcConfig(this.context.rtcSettings, mode, {
      iceCandidatePoolSize: this.context.iceCandidatePoolSize,
      turn: this.turn,
    });
    this.context.log("pc-created", {
      remoteId,
      mode,
      iceTransportPolicy: config.iceTransportPolicy,
    });
    return this.context.createPeerConnection(config);
  }

  private attachBinding(remoteId: string, pc: RTCPeerConnection, initiator: boolean): void {
    const binding = this.context.binding;
    const entry = this.context.peers.get(remoteId);
    if (!binding || !entry) return;
    if (binding.kind === "media") {
      entry.remoteStream = binding.attach(pc, remoteId);
      return;
    }
    if (initiator) {
      entry.dataChannel = binding.attachInitiator(pc, remoteId);
      return;
    }
    binding.attachReceiver(pc, remoteId, (channel) => {
      entry.dataChannel = channel;
    });
  }
}
