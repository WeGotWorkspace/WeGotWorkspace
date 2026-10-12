import { toRtcConfig } from "@/lib/rtc/config";
import { rtcSdpMeta } from "@/lib/rtc/log";
import type { RtcSessionBinding } from "@/lib/rtc/session/bindings";
import { openMeetDataChannel } from "@/lib/rtc/session/meet-data-channel";
import type { MeshPeerEntry, MeshPeerRegistry } from "@/lib/rtc/session/mesh-peer-registry";
import { logSelectedPairTelemetry } from "@/lib/rtc/telemetry/selected-pair";
import type { IceMode, RtcSettings, SignalingChannel, TurnCredentials } from "@/lib/rtc/types";

/** A local offer this fresh is still in flight. A second dial would glare. */
const OFFER_PENDING_MS = 10_000;

/** `relay` only when debug force-relay is on and TURN is actually configured. */
export function initialIceMode(
  settings: Pick<RtcSettings, "forceRelay" | "turnAvailable">,
): IceMode {
  return settings.forceRelay && settings.turnAvailable ? "relay" : "direct";
}

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
  /** Text from the negotiated Meet channel. Absent on collab and principal. */
  onMeetData?: (remoteId: string, data: string) => void;
  /** Test clock. Production uses `Date.now`. */
  now?: () => number;
};

/**
 * Brings peer connections up: the ICE transport mode, the `RTCPeerConnection`
 * itself, the media or data binding, whether an existing entry can be reused,
 * the outbound offer, and the one-shot relay retry after a failed direct link.
 */
export class MeshPeerDialer {
  private readonly turnConfigured: boolean;

  private turn: TurnCredentials | null = null;

  private loggedMissingRelayCredentials = false;

  constructor(private readonly context: MeshPeerDialerContext) {
    this.turnConfigured = context.rtcSettings.turnAvailable;
  }

  /** Credentials from a relay request, applied to peer connections created after this. */
  setTurn(turn: TurnCredentials | null): void {
    this.turn = turn;
  }

  /** Force-relay is on, TURN is configured, and no credential has been minted yet. */
  needsRelayCredentials(): boolean {
    return this.context.rtcSettings.forceRelay && this.turnConfigured && !this.turn;
  }

  /**
   * `relay` only after a precheck has minted credentials. `turnAvailable`
   * alone would mark the entry relay while `toRtcConfig` still leaves the
   * policy at `all`, and that pair never gathers a relay candidate.
   */
  initialMode(): IceMode {
    if (!this.context.rtcSettings.forceRelay || !this.turnConfigured) return "direct";
    return this.turn ? "relay" : "direct";
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
      dataChannel: this.openMeetChannel(pc, remoteId),
    };
    this.context.peers.add(remoteId, entry);
    this.context.wirePeerConnection(remoteId, entry);
    this.attachBinding(remoteId, pc, initiator);
    return entry;
  }

  async connectTo(remoteId: string, remoteName: string, forcedMode?: IceMode): Promise<void> {
    const myId = this.context.localPeerId();
    if (!myId || remoteId === myId) return;
    // Debug force-relay must not open a direct PC that wins ICE before the
    // precheck has credentials. The join path awaits that mint first.
    if (this.needsRelayCredentials() && !forcedMode) {
      this.noteMissingRelayCredentials(remoteId);
      return;
    }
    // ICE restart passes `forcedMode` after it has already dropped the old PC.
    if (!forcedMode && this.offerIsPending(remoteId)) {
      this.context.log("peer-skipped", { remoteId, reason: "offer-pending" });
      return;
    }
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
    entry.offeredAtMs = this.now();
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
      next.offeredAtMs = this.now();
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

  /** One log per dialer when force-relay has no credential yet, so no direct PC opens. */
  private noteMissingRelayCredentials(remoteId: string): void {
    if (this.loggedMissingRelayCredentials) return;
    if (!this.context.rtcSettings.forceRelay || !this.turnConfigured || this.turn) return;
    this.loggedMissingRelayCredentials = true;
    this.context.log("relay-mode-without-credentials", { remoteId });
  }

  /** The last offer is still in `have-local-offer` and is less than 10s old. */
  private offerIsPending(remoteId: string): boolean {
    const entry = this.context.peers.get(remoteId);
    if (!entry || entry.pc.signalingState !== "have-local-offer") return false;
    if (entry.offeredAtMs == null) return false;
    return this.now() - entry.offeredAtMs < OFFER_PENDING_MS;
  }

  private now(): number {
    return this.context.now?.() ?? Date.now();
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

  /** Negotiated Meet chat channel, created with the peer connection. Collab keeps its own binding. */
  private openMeetChannel(pc: RTCPeerConnection, remoteId: string): RTCDataChannel | null {
    if (this.context.channel !== "meet") return null;
    return openMeetDataChannel(pc, (data) => {
      this.context.onMeetData?.(remoteId, data);
    });
  }

  private attachBinding(remoteId: string, pc: RTCPeerConnection, initiator: boolean): void {
    const binding = this.context.binding;
    const entry = this.context.peers.get(remoteId);
    if (!binding || !entry) return;
    if (binding.kind === "media") {
      entry.remoteStream = binding.attach(pc, remoteId);
      return;
    }
    if (this.context.channel === "meet") return;
    if (initiator) {
      entry.dataChannel = binding.attachInitiator(pc, remoteId);
      return;
    }
    binding.attachReceiver(pc, remoteId, (channel) => {
      entry.dataChannel = channel;
    });
  }
}
