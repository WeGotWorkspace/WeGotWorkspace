import { toRtcConfig, turnUrlCount } from "@/lib/rtc/config";
import { rtcLog, rtcSdpMeta } from "@/lib/rtc/log";
import {
  collapseStaleIdentityPeers,
  peerIdentityKey,
  sortPrincipalDialPeers,
} from "@/lib/rtc/session/stale-identity-peers";
import {
  isUnchangedPollResponse,
  type HttpSignalingClient,
  type HttpSignalingPollResult,
} from "@/lib/rtc/signaling/http-client";
import type { RtcSessionBinding } from "@/lib/rtc/session/bindings";
import {
  flushPendingIce,
  parseCandidateProtocol,
  parseCandidateType,
  safeSetRemoteDescription,
  toSessionDescriptionPayload,
} from "@/lib/rtc/session/sdp";
import { logSelectedPairTelemetry } from "@/lib/rtc/telemetry/selected-pair";
import type {
  IceMode,
  RtcLinkState,
  RtcPeerDescriptor,
  RtcPollIntervals,
  RtcSettings,
  SignalingChannel,
} from "@/lib/rtc/types";
import { sortRtcSignalMessages } from "@/lib/rtc/types";

export type InitiatorRule = "lowerId" | "higherId";

export type RtcMeshVisibilityPort = {
  getState: () => DocumentVisibilityState;
  subscribe: (listener: () => void) => () => void;
};

export type RtcPeerMeshPorts = {
  createPeerConnection?: (config: RTCConfiguration) => RTCPeerConnection;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
  visibility?: RtcMeshVisibilityPort;
};

function defaultVisibilityPort(): RtcMeshVisibilityPort | null {
  if (typeof document === "undefined") return null;
  return {
    getState: () => document.visibilityState,
    subscribe: (listener) => {
      document.addEventListener("visibilitychange", listener);
      return () => document.removeEventListener("visibilitychange", listener);
    },
  };
}

export type RtcPeerMeshOptions = {
  channel: SignalingChannel;
  room: string;
  signaling: HttpSignalingClient;
  rtcSettings: RtcSettings;
  binding?: RtcSessionBinding;
  pollIntervals?: RtcPollIntervals;
  iceCandidatePoolSize?: number;
  initiatorRule?: InitiatorRule;
  recoverOnUnknownPeer?: boolean;
  ports?: RtcPeerMeshPorts;
  formatInboundDescription?: (
    payload: unknown,
    fallbackType: RTCSdpType,
  ) => RTCSessionDescriptionInit | null;
  formatOutboundDescription?: (description: RTCSessionDescriptionInit) => RTCSessionDescriptionInit;
  onLinkChange?: () => void;
  onUnknownPeer?: () => void;
  shouldConnectToPeer?: (peer: RtcPeerDescriptor) => boolean;
  shouldHandleRtcSignals?: () => boolean;
  onPollData?: (data: HttpSignalingPollResult) => void | Promise<void>;
  onPeerRemoved?: (remoteId: string, name: string, reason: "bye" | "roster") => void;
  onConnectionFailed?: (remoteId: string, name: string) => void;
  onPollError?: (error: unknown) => void;
  onPeerConnected?: (remoteId: string) => void;
};

type MeshPeerEntry = {
  name: string;
  pc: RTCPeerConnection;
  mode: IceMode;
  relayFallbackTried: boolean;
  initiator: boolean;
  pendingIce: RTCIceCandidateInit[];
  signalSent: boolean;
  remoteStream?: MediaStream;
  dataChannel?: RTCDataChannel | null;
};

const DEFAULT_POLL_INTERVALS: RtcPollIntervals = {
  connectingMs: 400,
  steadyMs: 1200,
};
const COLLAB_IDLE_POLL_INTERVAL_MS = 15000;
/** Meet idle backoff when connected with no knockers — shorter than collab for chat/control UX. */
const MEET_IDLE_POLL_INTERVAL_MS = 4000;
/** Hidden-tab backoff — applies only when the mesh holds no peer connections at all. */
const HIDDEN_IDLE_POLL_INTERVAL_MS = 60000;
/** Encoded knocker roster names — keep fast poll while guests wait for admit. */
const MEET_KNOCK_ROSTER_PREFIX = "__wgw_knock__:";
/** Limit how many new principal dials start on a single poll (ghost roster protection). */
const PRINCIPAL_MAX_NEW_CONNECTS_PER_POLL = 3;

export class RtcPeerMesh {
  private myId: string | null = null;

  private myName = "";

  private sessionKey: string | null = null;

  private lastMsgId = 0;

  private lastRosterSig: string | null = null;

  private lastRoomPeers: RtcPeerDescriptor[] = [];

  private lastLoggedPollDelayMs: number | null = null;

  private readonly droppedGhostIds = new Set<string>();

  private readonly peers = new Map<string, MeshPeerEntry>();

  private pollTimer: ReturnType<typeof setTimeout> | null = null;

  private pollInFlight = false;

  private rejoinInFlight = false;

  private readonly turnConfigured: boolean;

  private readonly createPeerConnection: (config: RTCConfiguration) => RTCPeerConnection;

  private readonly scheduleTimeout: typeof setTimeout;

  private readonly cancelTimeout: typeof clearTimeout;

  private readonly visibility: RtcMeshVisibilityPort | null;

  private visibilityUnsubscribe: (() => void) | null = null;

  constructor(private readonly options: RtcPeerMeshOptions) {
    this.turnConfigured = turnUrlCount(options.rtcSettings) > 0;
    this.createPeerConnection =
      options.ports?.createPeerConnection ?? ((config) => new RTCPeerConnection(config));
    this.scheduleTimeout = options.ports?.setTimeout ?? setTimeout.bind(globalThis);
    this.cancelTimeout = options.ports?.clearTimeout ?? clearTimeout.bind(globalThis);
    this.visibility = options.ports?.visibility ?? defaultVisibilityPort();
  }

  private log(event: string, details?: unknown): void {
    rtcLog({ channel: this.options.channel, peerId: this.myId }, event, details);
  }

  private pollIntervals(): RtcPollIntervals {
    return this.options.pollIntervals ?? DEFAULT_POLL_INTERVALS;
  }

  private isInitiator(remoteId: string): boolean {
    if (!this.myId) return false;
    const rule = this.options.initiatorRule ?? "lowerId";
    return rule === "lowerId" ? this.myId < remoteId : this.myId > remoteId;
  }

  private initialMode(): IceMode {
    return this.options.rtcSettings.forceRelay && this.turnConfigured ? "relay" : "direct";
  }

  private formatInbound(
    payload: unknown,
    fallbackType: RTCSdpType,
  ): RTCSessionDescriptionInit | null {
    if (this.options.formatInboundDescription) {
      return this.options.formatInboundDescription(payload, fallbackType);
    }
    return toSessionDescriptionPayload(payload, fallbackType);
  }

  private formatOutbound(description: RTCSessionDescriptionInit): RTCSessionDescriptionInit {
    if (this.options.formatOutboundDescription) {
      return this.options.formatOutboundDescription(description);
    }
    return description;
  }

  private linkState(entry: MeshPeerEntry): RtcLinkState {
    if (this.options.binding?.kind === "data") {
      return this.options.binding.linkState(entry.dataChannel ?? null, entry.pc);
    }
    const state = entry.pc.connectionState;
    if (state === "connected") return "connected";
    if (state === "connecting" || state === "new") return "connecting";
    if (state === "failed") return "failed";
    if (state === "disconnected") return "disconnected";
    return "closed";
  }

  getMyId(): string | null {
    return this.myId;
  }

  getRoomPeers(): RtcPeerDescriptor[] {
    return this.lastRoomPeers;
  }

  getPeerLinkStates(): Array<RtcPeerDescriptor & { link: RtcLinkState }> {
    return this.lastRoomPeers.map((peer) => {
      const entry = this.peers.get(peer.id);
      return {
        ...peer,
        link: entry ? this.linkState(entry) : "connecting",
      };
    });
  }

  getPeerConnection(remoteId: string): RTCPeerConnection | null {
    return this.peers.get(remoteId)?.pc ?? null;
  }

  getDataChannel(remoteId: string): RTCDataChannel | null {
    return this.peers.get(remoteId)?.dataChannel ?? null;
  }

  getRemoteStream(remoteId: string): MediaStream | null {
    return this.peers.get(remoteId)?.remoteStream ?? null;
  }

  getPeerIds(): string[] {
    return [...this.peers.keys()];
  }

  linkCount(): number {
    if (this.options.binding?.kind === "data") {
      let count = 0;
      for (const entry of this.peers.values()) {
        if (entry.dataChannel?.readyState === "open") count += 1;
      }
      return count;
    }
    let count = 0;
    for (const entry of this.peers.values()) {
      if (entry.pc.connectionState === "connected") count += 1;
    }
    return count;
  }

  broadcastJson(message: unknown): void {
    const raw = JSON.stringify(message);
    for (const entry of this.peers.values()) {
      if (entry.dataChannel?.readyState !== "open") continue;
      try {
        entry.dataChannel.send(raw);
      } catch {
        // ignore
      }
    }
  }

  sendJsonTo(remoteId: string, message: unknown): void {
    const entry = this.peers.get(remoteId);
    if (entry?.dataChannel?.readyState !== "open") return;
    try {
      entry.dataChannel.send(JSON.stringify(message));
    } catch {
      // ignore
    }
  }

  private isUnknownPeerError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    return error.message.includes("unknown_peer");
  }

  private isInvalidPeerError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    return error.message.includes("invalid_peer");
  }

  private handleRemoteSignalError(remoteId: string, error: unknown): void {
    if (this.options.recoverOnUnknownPeer && this.isUnknownPeerError(error)) {
      void this.recoverUnknownPeer();
      return;
    }
    if (this.isInvalidPeerError(error)) {
      this.droppedGhostIds.add(remoteId);
      this.removePeer(remoteId, "roster");
      this.log("peer-skipped", { remoteId, reason: "invalid-peer-signal" });
    }
  }

  private notifyLinkChange(): void {
    this.options.onLinkChange?.();
  }

  private async sendSignal(to: string, type: string, payload: unknown): Promise<void> {
    if (!this.myId) return;
    await this.options.signaling.send({
      room: this.options.room,
      from: this.myId,
      to,
      type,
      payload,
      sessionKey: this.sessionKey ?? undefined,
    });
  }

  private removePeer(remoteId: string, reason: "bye" | "roster" | "local" = "local"): void {
    const entry = this.peers.get(remoteId);
    if (!entry) return;
    const name = entry.name;
    entry.dataChannel?.close();
    entry.pc.close();
    this.peers.delete(remoteId);
    this.log("peer-removed", { remoteId, reason });
    if (reason !== "local") {
      this.options.onPeerRemoved?.(remoteId, name, reason);
    }
    this.notifyLinkChange();
  }

  private wirePcEvents(remoteId: string, entry: MeshPeerEntry): void {
    const { pc } = entry;
    pc.onicecandidate = (event) => {
      const candidate = event.candidate?.toJSON();
      if (
        !candidate ||
        typeof candidate.candidate !== "string" ||
        candidate.candidate.trim() === ""
      ) {
        if (event.candidate === null) this.log("ice-candidate-local-end", { remoteId });
        return;
      }
      this.log("ice-candidate-local", {
        remoteId,
        mode: entry.mode,
        candidateType: parseCandidateType(candidate.candidate),
        protocol: parseCandidateProtocol(candidate.candidate),
      });
      void this.sendSignal(remoteId, "ice", candidate).catch((error) => {
        this.handleRemoteSignalError(remoteId, error);
      });
    };
    pc.onconnectionstatechange = () => {
      this.log("pc-connection-state", {
        remoteId,
        mode: entry.mode,
        connectionState: pc.connectionState,
        iceConnectionState: pc.iceConnectionState,
      });
      if (pc.connectionState === "connected") {
        void logSelectedPairTelemetry(this.options.channel, this.myId, remoteId, pc, "connected");
        this.options.onPeerConnected?.(remoteId);
      }
      if (pc.connectionState === "failed") {
        void logSelectedPairTelemetry(this.options.channel, this.myId, remoteId, pc, "failed");
        void this.restartWithRelay(remoteId, entry).then((retried) => {
          if (!retried) this.handleConnectionFailed(remoteId, entry);
        });
      }
      this.notifyLinkChange();
    };
    pc.oniceconnectionstatechange = () => {
      this.log("ice-connection-state", {
        remoteId,
        iceConnectionState: pc.iceConnectionState,
        connectionState: pc.connectionState,
      });
      if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
        void logSelectedPairTelemetry(this.options.channel, this.myId, remoteId, pc, "connected");
      }
      if (pc.iceConnectionState === "failed") {
        void this.restartWithRelay(remoteId, entry).then((retried) => {
          if (!retried) this.handleConnectionFailed(remoteId, entry);
        });
      }
      this.notifyLinkChange();
    };
    pc.onicegatheringstatechange = () => {
      this.log("ice-gathering-state", { remoteId, iceGatheringState: pc.iceGatheringState });
    };
  }

  private makePc(remoteId: string, mode: IceMode): RTCPeerConnection {
    const config = toRtcConfig(this.options.rtcSettings, mode, {
      iceCandidatePoolSize: this.options.iceCandidatePoolSize,
    });
    this.log("pc-created", { remoteId, mode, iceTransportPolicy: config.iceTransportPolicy });
    const pc = this.createPeerConnection(config);
    return pc;
  }

  private attachBinding(remoteId: string, pc: RTCPeerConnection, initiator: boolean): void {
    const binding = this.options.binding;
    const entry = this.peers.get(remoteId);
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

  private async restartWithRelay(remoteId: string, entry: MeshPeerEntry): Promise<boolean> {
    if (
      !entry.initiator ||
      entry.mode === "relay" ||
      entry.relayFallbackTried ||
      !this.turnConfigured
    ) {
      return false;
    }
    entry.relayFallbackTried = true;
    this.log("relay-fallback-start", { remoteId, initiator: entry.initiator });
    try {
      this.removePeer(remoteId);
      await this.connectTo(remoteId, entry.name, "relay");
      const next = this.peers.get(remoteId);
      if (!next?.initiator) return false;
      const offer = await next.pc.createOffer({ iceRestart: true });
      const formatted = this.formatOutbound(offer);
      await next.pc.setLocalDescription(formatted);
      await this.sendSignal(remoteId, "offer", next.pc.localDescription);
      next.signalSent = true;
      this.log("relay-fallback-offer-sent", { remoteId });
      void logSelectedPairTelemetry(
        this.options.channel,
        this.myId,
        remoteId,
        next.pc,
        "relay-fallback",
      );
      return true;
    } catch (error) {
      this.log("relay-fallback-failed", { remoteId, error });
      return false;
    }
  }

  private shouldReusePeerEntry(remoteId: string, initiator: boolean): boolean {
    const entry = this.peers.get(remoteId);
    if (!entry) return false;
    if (entry.pc.connectionState === "failed" || entry.pc.iceConnectionState === "failed") {
      this.removePeer(remoteId);
      return false;
    }
    if (this.options.binding?.kind === "data" && entry.dataChannel?.readyState === "open") {
      return true;
    }
    if (this.options.binding?.kind === "media" && entry.pc.connectionState === "connected") {
      return true;
    }
    if (!initiator) return true;
    if (entry.signalSent) return true;
    return false;
  }

  private async connectTo(
    remoteId: string,
    remoteName: string,
    forcedMode?: IceMode,
  ): Promise<void> {
    if (!this.myId || remoteId === this.myId) return;
    const initiator = this.isInitiator(remoteId);
    if (this.shouldReusePeerEntry(remoteId, initiator)) return;
    if (this.peers.has(remoteId)) this.removePeer(remoteId);

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
    this.peers.set(remoteId, entry);
    this.wirePcEvents(remoteId, entry);
    this.attachBinding(remoteId, pc, initiator);
    this.log("peer-connect-start", { remoteId, remoteName, initiator, mode });

    if (initiator) {
      const offer = await pc.createOffer();
      const formatted = this.formatOutbound(offer);
      await pc.setLocalDescription(formatted);
      try {
        await this.sendSignal(remoteId, "offer", pc.localDescription);
      } catch (error) {
        this.handleRemoteSignalError(remoteId, error);
        throw error;
      }
      entry.signalSent = true;
      this.log("offer-sent", { remoteId, ...rtcSdpMeta(pc.localDescription) });
    }
  }

  private async handleOffer(from: string, peerName: string, payload: unknown): Promise<void> {
    this.log("offer-received", { from, ...rtcSdpMeta(payload) });
    const sdp = this.formatInbound(payload, "offer");
    if (!sdp) return;
    let entry = this.peers.get(from);
    if (!entry) {
      const mode = this.initialMode();
      const pc = this.makePc(from, mode);
      entry = {
        name: peerName,
        pc,
        mode,
        relayFallbackTried: mode === "relay",
        initiator: false,
        pendingIce: [],
        signalSent: false,
        dataChannel: null,
      };
      this.peers.set(from, entry);
      this.wirePcEvents(from, entry);
      this.attachBinding(from, pc, false);
    }
    if (entry.pc.signalingState !== "stable") {
      try {
        await entry.pc.setLocalDescription({ type: "rollback" });
      } catch {
        // Ignore rollback failures on incompatible states.
      }
    }
    await safeSetRemoteDescription(entry.pc, sdp);
    await flushPendingIce(entry.pc, entry.pendingIce);
    const answer = await entry.pc.createAnswer();
    const formatted = this.formatOutbound(answer);
    await entry.pc.setLocalDescription(formatted);
    try {
      await this.sendSignal(from, "answer", entry.pc.localDescription);
    } catch (error) {
      this.handleRemoteSignalError(from, error);
      return;
    }
    entry.signalSent = true;
    this.log("answer-sent", { to: from, ...rtcSdpMeta(entry.pc.localDescription) });
  }

  private async handleAnswer(from: string, payload: unknown): Promise<void> {
    this.log("answer-received", { from, ...rtcSdpMeta(payload) });
    const entry = this.peers.get(from);
    if (!entry) return;
    const sdp = this.formatInbound(payload, "answer");
    if (!sdp) return;
    if (entry.pc.signalingState === "stable") return;
    await safeSetRemoteDescription(entry.pc, sdp);
    await flushPendingIce(entry.pc, entry.pendingIce);
  }

  private async handleIce(from: string, payload: unknown): Promise<void> {
    const entry = this.peers.get(from);
    if (!entry) return;
    const candidate = payload as RTCIceCandidateInit | null;
    if (
      !candidate ||
      typeof candidate.candidate !== "string" ||
      candidate.candidate.trim() === ""
    ) {
      return;
    }
    if (!entry.pc.remoteDescription) {
      entry.pendingIce.push(candidate);
      return;
    }
    try {
      await entry.pc.addIceCandidate(candidate);
    } catch {
      if (!entry.pc.remoteDescription) entry.pendingIce.push(candidate);
    }
  }

  private async handleBye(from: string): Promise<void> {
    this.removePeer(from, "bye");
  }

  private rtcSignalsEnabled(): boolean {
    return this.options.shouldHandleRtcSignals?.() ?? true;
  }

  private handleConnectionFailed(remoteId: string, entry: MeshPeerEntry): void {
    if (this.options.channel === "principal") {
      this.droppedGhostIds.add(remoteId);
      this.removePeer(remoteId, "roster");
      this.log("peer-skipped", { remoteId, reason: "connect-failed" });
    }
    this.options.onConnectionFailed?.(remoteId, entry.name);
  }

  private collapseIdentityOnPoll(): boolean {
    return this.options.channel === "collab" || this.options.channel === "principal";
  }

  private async onPoll(data: HttpSignalingPollResult): Promise<void> {
    const rawIds = new Set(data.peers.map((peer) => peer.id));
    for (const id of [...this.droppedGhostIds]) {
      if (!rawIds.has(id)) this.droppedGhostIds.delete(id);
    }
    const others = data.peers.filter(
      (peer) => peer.id !== this.myId && !this.droppedGhostIds.has(peer.id),
    );
    const collapsed = this.collapseIdentityOnPoll()
      ? collapseStaleIdentityPeers(this.lastRoomPeers, others, true)
      : { keep: others, staleIds: [] as string[] };
    for (const staleId of collapsed.staleIds) this.droppedGhostIds.add(staleId);
    const pollData = { ...data, peers: collapsed.keep };
    if (collapsed.staleIds.length > 0) {
      this.log("roster-ghost-dropped", { staleIds: collapsed.staleIds });
      for (const staleId of collapsed.staleIds) this.removePeer(staleId, "roster");
    }
    this.log("roster-snapshot", {
      peers: collapsed.keep.map((peer) => ({ id: peer.id, name: peer.name, user: peer.user })),
    });

    await this.options.onPollData?.(pollData);

    const roomIds = new Set(data.peers.map((peer) => peer.id));
    this.lastRoomPeers = collapsed.keep;

    if (this.rtcSignalsEnabled()) {
      let newPrincipalConnects = 0;
      const dialOrder =
        this.options.channel === "principal"
          ? sortPrincipalDialPeers(this.lastRoomPeers, this.peers.keys(), this.droppedGhostIds)
          : this.lastRoomPeers;
      for (const peer of dialOrder) {
        if (this.options.shouldConnectToPeer && !this.options.shouldConnectToPeer(peer)) {
          this.log("peer-skipped", { remoteId: peer.id, reason: "should-connect-false" });
          continue;
        }
        if (
          this.options.channel === "principal" &&
          !this.peers.has(peer.id) &&
          newPrincipalConnects >= PRINCIPAL_MAX_NEW_CONNECTS_PER_POLL
        ) {
          this.log("peer-skipped", { remoteId: peer.id, reason: "dial-cap" });
          continue;
        }
        if (this.options.channel === "principal" && !this.peers.has(peer.id)) {
          newPrincipalConnects += 1;
        }
        void this.connectTo(peer.id, peer.name).catch((error) => {
          this.log("peer-connect-failed", { remoteId: peer.id, error });
        });
      }

      for (const id of [...this.peers.keys()]) {
        if (!roomIds.has(id)) this.removePeer(id, "roster");
      }
    }

    if (!this.rtcSignalsEnabled()) {
      this.notifyLinkChange();
      return;
    }

    const signals = sortRtcSignalMessages(
      data.messages.filter((message) => message.type !== "chat"),
    );
    for (const message of signals) {
      if (message.id !== undefined) {
        this.lastMsgId = Math.max(this.lastMsgId, message.id);
      }
      const peerName = data.peers.find((peer) => peer.id === message.from)?.name ?? "Peer";
      try {
        if (message.type === "offer") {
          await this.handleOffer(message.from, peerName, message.payload);
        } else if (message.type === "answer") {
          await this.handleAnswer(message.from, message.payload);
        } else if (message.type === "ice") {
          await this.handleIce(message.from, message.payload);
        } else if (message.type === "bye") {
          await this.handleBye(message.from);
        }
      } catch (error) {
        this.log("signal-handle-failed", { type: message.type, from: message.from, error });
      }
    }
    this.notifyLinkChange();
  }

  private async pollOnce(): Promise<void> {
    if (!this.myId || this.pollInFlight) return;
    this.pollInFlight = true;
    try {
      const data = await this.options.signaling.poll({
        room: this.options.room,
        peerId: this.myId,
        since: this.lastMsgId,
        sig: this.lastRosterSig ?? undefined,
        sessionKey: this.sessionKey ?? undefined,
      });
      if (isUnchangedPollResponse(data)) {
        this.log("poll-unchanged", { status: 204 });
        return;
      }
      this.log("poll-changed", { status: 200, peerCount: data.peers.length });
      this.lastRosterSig = typeof data.rosterSig === "string" ? data.rosterSig : null;
      await this.onPoll(data);
    } finally {
      this.pollInFlight = false;
    }
  }

  private hasStableCollabTopology(): boolean {
    if (this.options.channel !== "collab" || this.options.binding?.kind !== "data") return false;
    if (!this.rtcSignalsEnabled()) return false;
    for (const peer of this.lastRoomPeers) {
      const entry = this.peers.get(peer.id);
      if (!entry || this.linkState(entry) !== "connected") return false;
    }
    return true;
  }

  private hasKnockersInRoster(): boolean {
    return this.lastRoomPeers.some((peer) => peer.name.startsWith(MEET_KNOCK_ROSTER_PREFIX));
  }

  private hasStableMeetTopology(): boolean {
    if (this.options.channel !== "meet" || this.options.binding?.kind !== "media") return false;
    if (!this.rtcSignalsEnabled()) return false;
    if (this.hasKnockersInRoster()) return false;
    const activePeers = this.lastRoomPeers.filter(
      (peer) => !peer.name.startsWith(MEET_KNOCK_ROSTER_PREFIX),
    );
    for (const peer of activePeers) {
      const entry = this.peers.get(peer.id);
      if (!entry || this.linkState(entry) !== "connected") return false;
    }
    return true;
  }

  /** Hidden-tab backoff only applies to meshes without any peer connections. */
  private isHiddenWithoutPeerConnections(): boolean {
    return this.visibility?.getState() === "hidden" && this.peers.size === 0;
  }

  private steadyPollDelayMs(intervals: RtcPollIntervals): number {
    let delay = intervals.steadyMs;
    if (this.hasStableCollabTopology()) {
      delay = Math.max(delay, COLLAB_IDLE_POLL_INTERVAL_MS);
    } else if (this.hasStableMeetTopology()) {
      delay = Math.max(delay, MEET_IDLE_POLL_INTERVAL_MS);
    }
    if (this.isHiddenWithoutPeerConnections()) {
      delay = Math.max(delay, HIDDEN_IDLE_POLL_INTERVAL_MS);
    }
    return delay;
  }

  private onVisibilityChange(): void {
    if (!this.myId) return;
    if (this.visibility?.getState() === "visible") {
      this.log("visibility-poll-restore");
      this.schedulePoll(false);
      return;
    }
    // Reschedule so the hidden backoff (when applicable) kicks in without waiting a tick.
    this.schedulePoll(true);
  }

  private schedulePoll(steady = false): void {
    if (!this.myId) return;
    this.stopPolling();
    const intervals = this.pollIntervals();
    const delay = !steady ? intervals.connectingMs : this.steadyPollDelayMs(intervals);
    if (this.lastLoggedPollDelayMs !== delay) {
      this.lastLoggedPollDelayMs = delay;
      this.log("poll-interval", {
        delayMs: delay,
        steady,
        connectingMs: intervals.connectingMs,
        idleCollab: this.hasStableCollabTopology(),
      });
    }
    this.pollTimer = this.scheduleTimeout(() => {
      void this.pollOnce()
        .catch((error) => {
          if (this.options.recoverOnUnknownPeer && this.isUnknownPeerError(error)) {
            void this.recoverUnknownPeer();
            return;
          }
          this.log("poll-failed", { error });
          this.options.onPollError?.(error);
        })
        .finally(() => this.schedulePoll(true));
    }, delay);
  }

  stopPolling(): void {
    if (this.pollTimer !== null) {
      this.cancelTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Tear down an in-flight collab ICE handshake when principal reuse wins for
   * the same remote. Does not invoke `onPeerRemoved` — the peer was never live.
   */
  abortPeerConnection(remoteId: string): void {
    if (!this.peers.has(remoteId)) return;
    this.log("reuse-fresh-ice-abort", { remoteId });
    this.removePeer(remoteId, "local");
  }

  /**
   * Re-dial room peers after a collab reuse path ends (principal DC gone /
   * ack timeout). Poll may return 204 while the roster is unchanged, so this
   * must not wait for the next poll cycle.
   */
  retryRoomPeerConnections(): void {
    if (!this.myId || !this.rtcSignalsEnabled()) return;
    let awaitingRemoteOffer = false;
    for (const peer of this.lastRoomPeers) {
      if (peer.id === this.myId) continue;
      if (this.options.shouldConnectToPeer && !this.options.shouldConnectToPeer(peer)) {
        this.log("peer-skipped", { remoteId: peer.id, reason: "should-connect-false" });
        continue;
      }
      const entry = this.peers.get(peer.id);
      if (entry && this.linkState(entry) === "connected") {
        this.log("peer-skipped", { remoteId: peer.id, reason: "already-connected" });
        continue;
      }
      if (this.isInitiator(peer.id)) {
        this.log("reuse-fallback-connect", { remoteId: peer.id });
        void this.connectTo(peer.id, peer.name).catch((error) => {
          this.log("peer-connect-failed", { remoteId: peer.id, error });
        });
      } else {
        awaitingRemoteOffer = true;
      }
    }
    if (awaitingRemoteOffer) {
      this.log("reuse-fallback-poll-kick");
      this.schedulePoll(false);
    }
    this.notifyLinkChange();
  }

  /**
   * Gossip hint received from an already-connected peer: another peer joined
   * the room. Dial unknown peers where the local side is the initiator; for
   * the rest, reschedule an immediate poll so their offer is picked up without
   * waiting out the idle poll interval. Purely additive — the roster poll
   * remains the source of truth and a lost hint costs nothing.
   */
  applyPeerHint(peers: RtcPeerDescriptor[]): void {
    if (!this.myId || !this.rtcSignalsEnabled()) return;
    let awaitingRemoteOffer = false;
    const allowNameFallback = this.collapseIdentityOnPoll();
    const knownIdentities = new Set(
      this.lastRoomPeers
        .map((peer) => peerIdentityKey(peer, allowNameFallback))
        .filter((key): key is string => key !== null),
    );
    for (const peer of peers) {
      if (peer.id === this.myId) {
        this.log("peer-skipped", { remoteId: peer.id, reason: "self" });
        continue;
      }
      if (this.droppedGhostIds.has(peer.id) || this.peers.has(peer.id)) {
        this.log("peer-skipped", { remoteId: peer.id, reason: "already-known" });
        continue;
      }
      const identity = peerIdentityKey(peer, allowNameFallback);
      if (identity && knownIdentities.has(identity)) {
        this.log("peer-skipped", { remoteId: peer.id, reason: "stale-hint-identity" });
        this.droppedGhostIds.add(peer.id);
        continue;
      }
      if (this.options.shouldConnectToPeer && !this.options.shouldConnectToPeer(peer)) {
        this.log("peer-skipped", { remoteId: peer.id, reason: "should-connect-false" });
        continue;
      }
      if (this.isInitiator(peer.id)) {
        this.log("peer-hint-connect", { remoteId: peer.id });
        void this.connectTo(peer.id, peer.name).catch((error) => {
          this.log("peer-connect-failed", { remoteId: peer.id, error });
        });
      } else {
        awaitingRemoteOffer = true;
      }
    }
    if (awaitingRemoteOffer) {
      this.log("peer-hint-poll-kick");
      this.schedulePoll(false);
    }
  }

  async recoverUnknownPeer(): Promise<void> {
    if (!this.options.recoverOnUnknownPeer || this.rejoinInFlight || !this.myName.trim()) return;
    this.rejoinInFlight = true;
    const previousPeerId = this.myId;
    this.log("peer-recover-start", { previousPeerId });
    try {
      for (const id of [...this.peers.keys()]) this.removePeer(id);
      this.myId = null;
      this.lastMsgId = 0;
      this.lastRosterSig = null;
      const joined = await this.options.signaling.join({
        room: this.options.room,
        name: this.myName,
      });
      this.myId = joined.peerId ?? null;
      if (typeof joined.sessionKey === "string") this.sessionKey = joined.sessionKey;
      await this.onPoll({ peers: joined.peers, messages: [] });
      this.log("peer-recover-success", { previousPeerId, peerId: this.myId });
    } catch (error) {
      this.log("peer-recover-error", { previousPeerId, error });
      this.options.onUnknownPeer?.();
    } finally {
      this.rejoinInFlight = false;
    }
  }

  async join(input: { name: string; peerId?: string }): Promise<{
    peerId: string;
    peers: RtcPeerDescriptor[];
    sessionKey?: string | null;
  }> {
    this.myName = input.name.trim();
    if (!this.myName) throw new Error("Display name is required");
    this.log("join-request", { room: this.options.room, name: this.myName });
    const joined = await this.options.signaling.join({
      room: this.options.room,
      name: this.myName,
      peerId: input.peerId,
    });
    this.myId = joined.peerId ?? input.peerId ?? null;
    if (!this.myId) throw new Error("Signaling join did not return peerId");
    if (typeof joined.sessionKey === "string") this.sessionKey = joined.sessionKey;
    this.lastRosterSig = null;
    this.log("join-response", {
      peerId: this.myId,
      roster: joined.peers.map((peer) => ({ id: peer.id, name: peer.name, user: peer.user })),
    });
    this.visibilityUnsubscribe ??=
      this.visibility?.subscribe(() => this.onVisibilityChange()) ?? null;
    this.schedulePoll();
    await this.onPoll({ peers: joined.peers, messages: [] });
    return {
      peerId: this.myId,
      peers: joined.peers,
      sessionKey: joined.sessionKey,
    };
  }

  getSessionKey(): string | null {
    return this.sessionKey;
  }

  getMyName(): string {
    return this.myName;
  }

  async updateJoinName(name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed || !this.myId) return;
    this.myName = trimmed;
    const joined = await this.options.signaling.join({
      room: this.options.room,
      name: this.myName,
      peerId: this.myId,
    });
    if (typeof joined.sessionKey === "string") this.sessionKey = joined.sessionKey;
  }

  async sendByeToAll(): Promise<void> {
    for (const remoteId of [...this.peers.keys()]) {
      try {
        await this.sendSignal(remoteId, "bye", null);
      } catch {
        // Best-effort bye while leaving.
      }
    }
  }

  async replaceAudioTrack(track: MediaStreamTrack): Promise<void> {
    const updates: Promise<void>[] = [];
    for (const entry of this.peers.values()) {
      const sender = entry.pc.getSenders().find((s) => s.track?.kind === "audio");
      if (!sender) continue;
      updates.push(sender.replaceTrack(track));
    }
    await Promise.all(updates);
  }

  async replaceVideoTrack(track: MediaStreamTrack): Promise<void> {
    const updates: Promise<void>[] = [];
    for (const entry of this.peers.values()) {
      const sender = entry.pc.getSenders().find((s) => s.track?.kind === "video");
      if (!sender) continue;
      updates.push(sender.replaceTrack(track));
    }
    await Promise.all(updates);
  }

  async leave(): Promise<void> {
    this.stopPolling();
    this.visibilityUnsubscribe?.();
    this.visibilityUnsubscribe = null;
    this.pollInFlight = false;
    const peerId = this.myId;
    const sessionKey = this.sessionKey;
    this.myId = null;
    if (peerId) {
      try {
        await this.options.signaling.leave({
          room: this.options.room,
          peerId,
          sessionKey: sessionKey ?? undefined,
        });
      } catch {
        // Ignore leave failures during cleanup.
      }
    }
    for (const id of [...this.peers.keys()]) this.removePeer(id);
    this.myName = "";
    this.sessionKey = null;
    this.lastMsgId = 0;
    this.lastRosterSig = null;
    this.lastRoomPeers = [];
    this.droppedGhostIds.clear();
    this.lastLoggedPollDelayMs = null;
  }
}
