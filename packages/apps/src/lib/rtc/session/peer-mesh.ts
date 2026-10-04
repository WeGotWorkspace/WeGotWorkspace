import { rtcLog, rtcSdpMeta } from "@/lib/rtc/log";
import type { NetClass } from "@/lib/rtc/net-probe";
import { netClassForJoin } from "@/lib/rtc/net-probe-session";
import { icePayloadCandidates, type IceOutbound } from "@/lib/rtc/session/ice-batch";
import type { IceRecovery } from "@/lib/rtc/session/ice-recovery";
import {
  bindNetworkRecovery,
  buildMeshConnectivity,
  hostFromSurface,
  type MeshSurface,
} from "@/lib/rtc/session/mesh-connectivity";
import type { MeshRelay } from "@/lib/rtc/session/mesh-relay";
import { piggybackPoll } from "@/lib/rtc/session/send-piggyback";
import {
  applyPeerHint as applyIncomingPeerHint,
  dialRoomPeers as dialListedRoomPeers,
  retryRoomPeerConnections as retryUnconnectedRoomPeers,
} from "@/lib/rtc/session/mesh-room-dial";
import type { MeshRoomDial } from "@/lib/rtc/session/mesh-room-dial";
import { collapseStaleIdentityPeers } from "@/lib/rtc/session/stale-identity-peers";
import type {
  HttpSignalingJoinResult,
  HttpSignalingPollResult,
} from "@/lib/rtc/signaling/http-client";
import { MeshPeerDialer } from "@/lib/rtc/session/mesh-peer-dialer";
import { MeshPeerRegistry, type MeshPeerEntry } from "@/lib/rtc/session/mesh-peer-registry";
import { MeshPollLoop } from "@/lib/rtc/session/mesh-poll-loop";
import { MeshSignalInbox } from "@/lib/rtc/session/mesh-signal-inbox";
import { wirePeerConnectionListeners } from "@/lib/rtc/session/peer-connection-listeners";
import {
  defaultVisibilityPort,
  type InitiatorRule,
  type RtcMeshVisibilityPort,
  type RtcPeerMeshOptions,
  type RtcPeerMeshPorts,
} from "@/lib/rtc/session/peer-mesh-options";
import type { MeshPollCadenceSnapshot } from "@/lib/rtc/session/poll-cadence";
import {
  flushPendingIce,
  safeSetRemoteDescription,
  toSessionDescriptionPayload,
} from "@/lib/rtc/session/sdp";
import {
  DEFAULT_RTC_POLL_INTERVALS,
  type RtcLinkState,
  type RtcPeerDescriptor,
  type RtcPollIntervals,
} from "@/lib/rtc/types";

export type { InitiatorRule, RtcMeshVisibilityPort, RtcPeerMeshOptions, RtcPeerMeshPorts };

export class RtcPeerMesh {
  private myId: string | null = null;

  private myName = "";

  private sessionKey: string | null = null;

  private lastRosterSig: string | null = null;

  private lastRoomPeers: RtcPeerDescriptor[] = [];

  private readonly droppedGhostIds = new Set<string>();

  private readonly peers: MeshPeerRegistry;

  private readonly dialer: MeshPeerDialer;

  private readonly inbox: MeshSignalInbox;

  private readonly pollLoop: MeshPollLoop;

  private rejoinInFlight = false;

  private localNet: NetClass | undefined;
  private iceOut: IceOutbound | null = null;
  private meshRelay: MeshRelay | null = null;
  private recovery: IceRecovery | null = null;
  private networkUnsubscribe: (() => void) | null = null;

  private readonly scheduleTimeout: typeof setTimeout;

  private readonly cancelTimeout: typeof clearTimeout;

  private readonly visibility: RtcMeshVisibilityPort | null;

  private visibilityUnsubscribe: (() => void) | null = null;

  constructor(private readonly options: RtcPeerMeshOptions) {
    this.peers = new MeshPeerRegistry(options.binding, (remoteId, error) => {
      const message = error instanceof Error ? error.message : String(error);
      this.log("send-failed", { remoteId, message });
      options.onSendFailed?.(remoteId);
    });
    this.dialer = new MeshPeerDialer({
      channel: options.channel,
      rtcSettings: options.rtcSettings,
      binding: options.binding,
      iceCandidatePoolSize: options.iceCandidatePoolSize,
      peers: this.peers,
      createPeerConnection:
        options.ports?.createPeerConnection ?? ((config) => new RTCPeerConnection(config)),
      localPeerId: () => this.myId,
      isInitiator: (remoteId) => this.isInitiator(remoteId),
      log: (event, details) => this.log(event, details),
      formatOutbound: (description) => this.formatOutbound(description),
      sendSignal: (to, type, payload) => this.sendSignal(to, type, payload),
      onRemoteSignalError: (remoteId, error) => this.handleRemoteSignalError(remoteId, error),
      removePeer: (remoteId) => this.removePeer(remoteId),
      wirePeerConnection: (remoteId, entry) => this.wirePcEvents(remoteId, entry),
      onMeetData: (remoteId, data) => this.options.onMeetData?.(remoteId, data),
    });
    this.inbox = new MeshSignalInbox({
      shouldAcceptOffer: options.shouldAcceptOffer,
      handleOffer: (from, peerName, payload) => this.handleOffer(from, peerName, payload),
      handleAnswer: (from, payload) => this.handleAnswer(from, payload),
      handleIce: (from, payload) => this.handleIce(from, payload),
      handleBye: (from) => this.handleBye(from),
      handleRelayHint: () => this.schedulePoll(false),
      log: (event, details) => this.log(event, details),
    });
    this.scheduleTimeout = options.ports?.setTimeout ?? setTimeout.bind(globalThis);
    this.cancelTimeout = options.ports?.clearTimeout ?? clearTimeout.bind(globalThis);
    this.visibility = options.ports?.visibility ?? defaultVisibilityPort();
    this.pollLoop = new MeshPollLoop({
      myId: () => this.myId,
      poll: (input) => options.signaling.poll(input),
      pollInput: () => ({
        room: options.room,
        since: this.inbox.cursor(),
        sig: this.lastRosterSig ?? undefined,
        sessionKey: this.sessionKey ?? undefined,
      }),
      setRosterSig: (sig) => {
        this.lastRosterSig = sig;
      },
      onPoll: (data) => this.onPoll(data),
      pollIntervals: () => this.pollIntervals(),
      cadence: () => this.pollCadenceSnapshot(),
      shouldRecover: (error) =>
        Boolean(options.recoverOnUnknownPeer && this.isUnknownPeerError(error)),
      recover: () => this.recoverUnknownPeer(),
      onPollError: options.onPollError,
      isVisible: () => this.visibility?.getState() === "visible",
      log: (event, details) => this.log(event, details),
      scheduleTimeout: this.scheduleTimeout,
      cancelTimeout: this.cancelTimeout,
    });
  }

  private log(event: string, details?: unknown): void {
    rtcLog({ channel: this.options.channel, peerId: this.myId }, event, details);
  }

  private pollIntervals(): RtcPollIntervals {
    return this.options.pollIntervals ?? DEFAULT_RTC_POLL_INTERVALS;
  }

  private isInitiator(remoteId: string): boolean {
    if (!this.myId) return false;
    const rule = this.options.initiatorRule ?? "lowerId";
    return rule === "lowerId" ? this.myId < remoteId : this.myId > remoteId;
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

  getMyId(): string | null {
    return this.myId;
  }

  getRoomPeers(): RtcPeerDescriptor[] {
    return this.lastRoomPeers;
  }

  getPeerLinkStates(): Array<RtcPeerDescriptor & { link: RtcLinkState }> {
    return this.lastRoomPeers.map((peer) => ({
      ...peer,
      link: this.peers.linkStateOf(peer.id) ?? "connecting",
    }));
  }

  getPeerConnection(remoteId: string): RTCPeerConnection | null {
    return this.peers.peerConnection(remoteId);
  }

  getDataChannel(remoteId: string): RTCDataChannel | null {
    return this.peers.dataChannel(remoteId);
  }

  getRemoteStream(remoteId: string): MediaStream | null {
    return this.peers.remoteStream(remoteId);
  }

  getPeerIds(): string[] {
    return this.peers.ids();
  }

  linkCount(): number {
    return this.peers.linkCount();
  }

  broadcastJson(message: unknown): void {
    this.peers.broadcastJson(message);
  }

  sendJsonTo(remoteId: string, message: unknown): void {
    this.peers.sendJsonTo(remoteId, message);
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
    const response = await this.options.signaling.send({
      room: this.options.room,
      from: this.myId,
      to,
      type,
      payload,
      sessionKey: this.sessionKey ?? undefined,
    });
    if (type === "offer" || type === "answer") this.recovery?.onSignaled(to);
    const piggy = piggybackPoll(response);
    if (!piggy || piggy.messages.length === 0) return;
    await this.onPoll(piggy);
  }

  kickPoll(): void {
    this.schedulePoll(false);
  }

  private removePeer(remoteId: string, reason: "bye" | "roster" | "local" = "local"): void {
    this.iceOut?.drop(remoteId);
    const name = this.peers.close(remoteId);
    if (name === null) return;
    this.log("peer-removed", { remoteId, reason });
    if (reason !== "local") {
      this.options.onPeerRemoved?.(remoteId, name, reason);
    }
    this.notifyLinkChange();
  }

  private wirePcEvents(remoteId: string, entry: MeshPeerEntry): void {
    wirePeerConnectionListeners(remoteId, entry, {
      channel: this.options.channel,
      localPeerId: () => this.myId,
      log: (event, details) => this.log(event, details),
      sendIceCandidate: (id, candidate) => {
        this.ensureConnectivity();
        this.iceOut?.note(id, candidate);
      },
      onConnected: (id) => {
        this.recovery?.onConnected(id);
        this.options.onPeerConnected?.(id);
      },
      onIceState: (id, state) => {
        if (state === "disconnected") this.recovery?.onDisconnected(id);
        if (state === "connected" || state === "completed") this.recovery?.onConnected(id);
      },
      onFailure: (id, failed) => {
        this.recovery?.onFailed(id);
        if (this.meshRelay?.hasRequested(id)) return;
        void this.dialer.restartWithRelay(id, failed).then((retried) => {
          if (!retried) this.handleConnectionFailed(id, failed);
        });
      },
      onLinkChange: () => this.notifyLinkChange(),
    });
  }

  private async handleOffer(from: string, peerName: string, payload: unknown): Promise<void> {
    this.log("offer-received", { from, ...rtcSdpMeta(payload) });
    const sdp = this.formatInbound(payload, "offer");
    if (!sdp) return;
    const entry = this.peers.get(from) ?? this.dialer.createEntry(from, peerName, false);
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
    this.recovery?.onSignaled(from);
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
    for (const candidate of icePayloadCandidates(payload)) {
      if (!entry.pc.remoteDescription) {
        entry.pendingIce.push(candidate);
        continue;
      }
      try {
        await entry.pc.addIceCandidate(candidate);
      } catch {
        if (!entry.pc.remoteDescription) entry.pendingIce.push(candidate);
      }
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

  /**
   * Principal still collapses a reloaded tab into one peer. Collab does not:
   * two devices of the same user are both live, and a same-browser reload is
   * evicted by `browserId` on the server.
   */
  private collapseIdentityOnPoll(): boolean {
    return this.options.channel === "principal";
  }

  private async onPoll(data: HttpSignalingPollResult): Promise<void> {
    const messages = this.inbox.claim(data.messages);
    if (data.messages.length > 0 && messages.length === 0) return;
    data = { ...data, messages };
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
      this.dialRoomPeers();
      for (const id of this.peers.ids()) {
        if (!roomIds.has(id)) this.removePeer(id, "roster");
      }
    }

    if (this.rtcSignalsEnabled()) {
      await this.inbox.applySignals(data);
    }
    // Ack last, and for every row: a lobby guest handles no RTC signals but must
    // still move its cursor, or the server keeps resending its `admit`.
    this.inbox.ack(data.messages);
    this.notifyLinkChange();
  }

  private roomDial(): MeshRoomDial {
    return {
      myId: this.myId,
      principal: this.options.channel === "principal",
      roomPeers: this.lastRoomPeers,
      droppedGhostIds: this.droppedGhostIds,
      hasPeer: (id) => this.peers.has(id),
      peerIds: () => this.peers.ids(),
      linkStateOf: (id) => this.peers.linkStateOf(id),
      shouldConnectToPeer: this.options.shouldConnectToPeer,
      isInitiator: (id) => this.isInitiator(id),
      rtcSignalsEnabled: () => this.rtcSignalsEnabled(),
      allowNameFallback: this.collapseIdentityOnPoll(),
      rememberCaps: (id, caps) => this.peers.rememberCaps(id, caps),
      connectTo: (id, name) => this.dialer.connectTo(id, name),
      log: (event, details) => this.log(event, details),
      kickPoll: () => this.schedulePoll(false),
      notifyLinkChange: () => this.notifyLinkChange(),
    };
  }

  /** Dial everyone on the fresh roster, respecting the principal per-poll dial cap. */
  private dialRoomPeers(): void {
    dialListedRoomPeers(this.roomDial());
  }

  private pollCadenceSnapshot(): MeshPollCadenceSnapshot {
    return {
      channel: this.options.channel,
      bindingKind: this.options.binding?.kind ?? null,
      rtcSignalsEnabled: this.rtcSignalsEnabled(),
      roomPeers: this.lastRoomPeers,
      linkStateOf: (peerId) => this.peers.linkStateOf(peerId),
      hidden: this.visibility?.getState() === "hidden",
      peerConnectionCount: this.peers.size,
    };
  }

  private schedulePoll(steady = false): void {
    this.pollLoop.schedule(steady);
  }

  stopPolling(): void {
    this.pollLoop.stop();
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
    retryUnconnectedRoomPeers(this.roomDial());
  }

  /**
   * Gossip hint received from an already-connected peer: another peer joined
   * the room. Dial unknown peers where the local side is the initiator; for
   * the rest, reschedule an immediate poll so their offer is picked up without
   * waiting out the idle poll interval. Purely additive — the roster poll
   * remains the source of truth and a lost hint costs nothing.
   */
  applyPeerHint(peers: RtcPeerDescriptor[]): void {
    applyIncomingPeerHint(this.roomDial(), peers);
  }

  async recoverUnknownPeer(): Promise<void> {
    if (!this.options.recoverOnUnknownPeer || this.rejoinInFlight || !this.myName.trim()) return;
    this.rejoinInFlight = true;
    const previousPeerId = this.myId;
    this.log("peer-recover-start", { previousPeerId });
    try {
      for (const id of this.peers.ids()) this.removePeer(id);
      this.myId = null;
      this.inbox.reset();
      this.lastRosterSig = null;
      const joined = await this.signalingJoin(previousPeerId ?? undefined);
      this.myId = joined.peerId ?? previousPeerId ?? null;
      await this.prepareRelay();
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
    limits?: HttpSignalingJoinResult["rtc"];
  }> {
    this.myName = input.name.trim();
    if (!this.myName) throw new Error("Display name is required");
    this.log("join-request", { room: this.options.room, name: this.myName });
    const joined = await this.signalingJoin(input.peerId);
    this.myId = joined.peerId ?? input.peerId ?? null;
    if (!this.myId) throw new Error("Signaling join did not return peerId");
    await this.prepareRelay();
    if (typeof joined.sessionKey === "string") this.sessionKey = joined.sessionKey;
    this.lastRosterSig = null;
    this.log("join-response", {
      peerId: this.myId,
      roster: joined.peers.map((peer) => ({ id: peer.id, name: peer.name, user: peer.user })),
    });
    this.visibilityUnsubscribe ??=
      this.visibility?.subscribe(() => this.pollLoop.onVisibilityChange()) ?? null;
    this.schedulePoll();
    await this.onPoll({ peers: joined.peers, messages: [] });
    this.installNetworkRecovery();
    return {
      peerId: this.myId,
      peers: joined.peers,
      sessionKey: joined.sessionKey,
      limits: joined.rtc,
    };
  }

  private async signalingJoin(peerId?: string) {
    this.ensureConnectivity();
    const net =
      this.options.channel === "meet" || this.options.channel === "collab"
        ? await netClassForJoin(this.options.rtcSettings)
        : undefined;
    if (net) this.localNet = net;
    return this.options.signaling.join({
      room: this.options.room,
      name: this.myName,
      peerId,
      sessionKey: this.sessionKey ?? undefined,
      net,
    });
  }

  private async prepareRelay(): Promise<void> {
    await this.meshRelay?.beforeDial();
    this.dialer.setTurn(this.meshRelay?.credentials() ?? null);
  }

  private surface(): MeshSurface {
    return {
      options: this.options,
      scheduleTimeout: this.scheduleTimeout,
      cancelTimeout: this.cancelTimeout,
      getMyId: () => this.myId,
      getLocalNet: () => this.localNet,
      setLocalNet: (net) => {
        this.localNet = net;
      },
      getRoomPeers: () => this.lastRoomPeers,
      peerEntry: (id) => this.peers.get(id),
      peerIds: () => this.peers.ids(),
      peerConnection: (id) => this.peers.peerConnection(id),
      isInitiator: (id) => this.isInitiator(id),
      sendSignal: (to, type, payload) => this.sendSignal(to, type, payload),
      onSignalError: (id, error) => this.handleRemoteSignalError(id, error),
      formatOutbound: (description) => this.formatOutbound(description),
      setTurn: (turn) => this.dialer.setTurn(turn),
      restartWithRelay: (id, entry) => this.dialer.restartWithRelay(id, entry),
      onGiveUp: (id, entry) => this.handleConnectionFailed(id, entry),
      kickPoll: () => this.schedulePoll(false),
      log: (event, details) => this.log(event, details),
      sessionKey: () => this.sessionKey,
    };
  }

  private ensureConnectivity(): void {
    if (this.iceOut) return;
    const built = buildMeshConnectivity(hostFromSurface(this.surface()));
    this.iceOut = built.iceOut;
    this.meshRelay = built.relay;
    this.recovery = built.recovery;
  }

  private installNetworkRecovery(): void {
    if (this.networkUnsubscribe || !this.recovery) return;
    this.networkUnsubscribe = bindNetworkRecovery(hostFromSurface(this.surface()), this.recovery);
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
    const joined = await this.signalingJoin(this.myId);
    if (typeof joined.sessionKey === "string") this.sessionKey = joined.sessionKey;
    // Same-peer rename (admit): refresh roster and dial now — do not wait for
    // the next poll, which may already be on the idle interval.
    await this.onPoll({ peers: joined.peers, messages: [] });
  }

  async sendByeToAll(): Promise<void> {
    for (const remoteId of this.peers.ids()) {
      try {
        await this.sendSignal(remoteId, "bye", null);
      } catch {
        // Best-effort bye while leaving.
      }
    }
  }

  async replaceAudioTrack(track: MediaStreamTrack): Promise<void> {
    await this.peers.replaceSenderTrack("audio", track);
  }

  async replaceVideoTrack(track: MediaStreamTrack): Promise<void> {
    await this.peers.replaceSenderTrack("video", track);
  }

  async leave(): Promise<void> {
    this.stopPolling();
    this.pollLoop.release();
    this.networkUnsubscribe?.();
    this.networkUnsubscribe = null;
    this.iceOut?.dispose();
    this.recovery?.dispose();
    this.visibilityUnsubscribe?.();
    this.visibilityUnsubscribe = null;
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
    for (const id of this.peers.ids()) this.removePeer(id);
    this.myName = "";
    this.sessionKey = null;
    this.inbox.reset();
    this.lastRosterSig = null;
    this.lastRoomPeers = [];
    this.droppedGhostIds.clear();
  }
}
