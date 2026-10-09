import { applyRtcDebugOverrides } from "@/lib/rtc/force-relay";
import { rtcLog } from "@/lib/rtc/log";
import { applyTurnOnPeerConnection } from "@/lib/rtc/session/apply-turn";
import type { NetClass } from "@/lib/rtc/net-probe";
import { netClassForJoin } from "@/lib/rtc/net-probe-session";
import type { IceOutbound } from "@/lib/rtc/session/ice-batch";
import type { IceRecovery } from "@/lib/rtc/session/ice-recovery";
import {
  bindNetworkRecovery,
  buildMeshConnectivity,
  hostFromSurface,
  type MeshSurface,
} from "@/lib/rtc/session/mesh-connectivity";
import { enqueueMeshJoin } from "@/lib/rtc/session/mesh-join-queue";
import type { MeshRelay } from "@/lib/rtc/session/mesh-relay";
import { piggybackPoll } from "@/lib/rtc/session/send-piggyback";
import {
  applyPeerHint as applyIncomingPeerHint,
  dialRoomPeers as dialListedRoomPeers,
  retryRoomPeer,
  retryRoomPeerConnections as retryUnconnectedRoomPeers,
} from "@/lib/rtc/session/mesh-room-dial";
import type { MeshRoomDial } from "@/lib/rtc/session/mesh-room-dial";
import { collapseStaleIdentityPeers } from "@/lib/rtc/session/stale-identity-peers";
import type {
  HttpSignalingJoinResult,
  HttpSignalingPollResult,
} from "@/lib/rtc/signaling/http-client";
import type { RelayReason } from "@/lib/rtc/session/relay-request";
import { MeshPeerDialer } from "@/lib/rtc/session/mesh-peer-dialer";
import { MeshPeerRegistry, type MeshPeerEntry } from "@/lib/rtc/session/mesh-peer-registry";
import { MeshPollLoop } from "@/lib/rtc/session/mesh-poll-loop";
import {
  acceptMeshAnswer,
  acceptMeshIce,
  acceptMeshOffer,
  type MeshSdpExchange,
} from "@/lib/rtc/session/mesh-sdp-exchange";
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
import { toSessionDescriptionPayload } from "@/lib/rtc/session/sdp";
import { SessionMetricsReporter } from "@/lib/rtc/telemetry/session-metrics-reporter";
import {
  DEFAULT_RTC_POLL_INTERVALS,
  type RtcLinkState,
  type RtcPeerDescriptor,
  type RtcPollIntervals,
  type TurnCredentials,
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

  /**
   * Bumped on every join and leave. An in-flight join from a StrictMode
   * cleanup must not dial after `leave` has moved the epoch.
   */
  private sessionEpoch = 0;

  private activeEpoch = 0;

  private localNet: NetClass | undefined;
  private iceOut: IceOutbound | null = null;
  private meshRelay: MeshRelay | null = null;
  private recovery: IceRecovery | null = null;
  private networkUnsubscribe: (() => void) | null = null;

  private readonly scheduleTimeout: typeof setTimeout;

  private readonly cancelTimeout: typeof clearTimeout;

  private readonly visibility: RtcMeshVisibilityPort | null;

  private visibilityUnsubscribe: (() => void) | null = null;

  private readonly metrics: SessionMetricsReporter;

  private readonly options: RtcPeerMeshOptions;

  constructor(options: RtcPeerMeshOptions) {
    // Meet, collab, and principal all honor `?rtcForceRelay=1`. Principal used
    // to clear the flag, so its peer connection stayed on `iceTransportPolicy: all`.
    const rtcSettings =
      options.channel === "meet" || options.channel === "collab" || options.channel === "principal"
        ? applyRtcDebugOverrides(options.rtcSettings)
        : options.rtcSettings;
    this.options = { ...options, rtcSettings };
    this.peers = new MeshPeerRegistry(options.binding, (remoteId, error) => {
      const message = error instanceof Error ? error.message : String(error);
      this.log("send-failed", { remoteId, message });
      options.onSendFailed?.(remoteId);
    });
    this.dialer = new MeshPeerDialer({
      channel: options.channel,
      rtcSettings: this.options.rtcSettings,
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
      handleOffer: (from, peerName, payload) =>
        acceptMeshOffer(this.sdpExchange(), from, peerName, payload),
      handleAnswer: (from, payload) => acceptMeshAnswer(this.sdpExchange(), from, payload),
      handleIce: (from, payload) => acceptMeshIce(this.sdpExchange(), from, payload),
      handleBye: (from) => this.handleBye(from),
      handleRelayHint: () => this.schedulePoll(false),
      log: (event, details) => this.log(event, details),
    });
    this.scheduleTimeout = options.ports?.setTimeout ?? setTimeout.bind(globalThis);
    this.cancelTimeout = options.ports?.clearTimeout ?? clearTimeout.bind(globalThis);
    this.visibility = options.ports?.visibility ?? defaultVisibilityPort();
    const reportSessionMetric = options.signaling.reportSessionMetric?.bind(options.signaling);
    this.metrics = new SessionMetricsReporter({
      channel: options.channel,
      post:
        typeof options.signaling.reportSessionMetric === "function"
          ? reportSessionMetric
          : undefined,
      sessionKey: () => this.sessionKey,
      net: () => this.localNet,
      schedule: this.scheduleTimeout,
      cancel: this.cancelTimeout,
    });
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
      onPollRoundTrip: (elapsedMs) => this.metrics.notePollRtt(elapsedMs),
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

  isInitiatorFor(remoteId: string): boolean {
    return this.isInitiator(remoteId);
  }

  /** Collab mailbox send (`yjs` / `yjs-sv`). Piggybacked rows still hit the poll. */
  sendMailbox(to: string, type: string, payload: unknown): Promise<void> {
    return this.sendSignal(to, type, payload);
  }

  localNetClass(): NetClass | undefined {
    return this.localNet;
  }

  /**
   * Put just-in-time TURN on the existing connection and dial again. Docs calls
   * this after `requestRelay` returns credentials; Meet keeps its own timer.
   */
  retryPeerWithRelay(remoteId: string, turn: TurnCredentials): void {
    const pc = this.peers.peerConnection(remoteId);
    if (pc) {
      applyTurnOnPeerConnection(
        pc,
        this.options.rtcSettings,
        turn,
        this.options.iceCandidatePoolSize,
      );
    }
    this.retryRoomPeerConnections();
  }

  postRelay(body: {
    target: string;
    reason: RelayReason;
    net?: NetClass;
  }): Promise<{ turn: TurnCredentials }> {
    if (!this.myId) return Promise.reject(new Error("not_joined"));
    return this.options.signaling.relay({
      room: this.options.room,
      peerId: this.myId,
      target: body.target,
      reason: body.reason,
      net: body.net,
      sessionKey: this.sessionKey ?? undefined,
    });
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
        void this.metrics.noteConnected(entry.pc);
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

  private sdpExchange(): MeshSdpExchange {
    return {
      getPeer: (id) => this.peers.get(id),
      createEntry: (id, name, initiator) => this.dialer.createEntry(id, name, initiator),
      replacePeer: (id) => this.removePeer(id, "local"),
      needsRelayCredentials: () => this.dialer.needsRelayCredentials(),
      prepareRelay: () => this.prepareRelay(),
      formatInbound: (payload, fallbackType) => this.formatInbound(payload, fallbackType),
      formatOutbound: (description) => this.formatOutbound(description),
      sendSignal: (to, type, payload) => this.sendSignal(to, type, payload),
      onSignalError: (id, error) => this.handleRemoteSignalError(id, error),
      onSignaled: (id) => {
        this.recovery?.onSignaled(id);
      },
      log: (event, details) => this.log(event, details),
    };
  }

  private async handleBye(from: string): Promise<void> {
    this.removePeer(from, "bye");
  }

  private rtcSignalsEnabled(): boolean {
    return this.options.shouldHandleRtcSignals?.() ?? true;
  }

  private handleConnectionFailed(remoteId: string, entry: MeshPeerEntry): void {
    this.metrics.noteFailedPair();
    if (this.options.channel === "collab") this.metrics.noteHttpFallback();
    if (this.options.channel === "principal") {
      this.removePeer(remoteId, "roster");
      this.log("peer-skipped", { remoteId, reason: "connect-failed" });
    }
    this.options.onConnectionFailed?.(remoteId, entry.name);
  }

  /**
   * No channel collapses peers by user any more. The server evicts a reloaded
   * tab by browser id, and two browsers of one user are both live.
   */
  private collapseIdentityOnPoll(): boolean {
    return false;
  }

  private async onPoll(data: HttpSignalingPollResult): Promise<void> {
    if (this.activeEpoch !== this.sessionEpoch) return;
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
   * Tear down an in-flight peer connection (for example when the link
   * supervisor re-dials). Does not invoke `onPeerRemoved` — the peer was never
   * live on the product channel.
   */
  abortPeerConnection(remoteId: string): void {
    if (!this.peers.has(remoteId)) return;
    this.log("peer-abort", { remoteId });
    this.removePeer(remoteId, "local");
  }

  /**
   * Re-dial room peers that are not yet connected. Poll may return 204 while
   * the roster is unchanged, so this must not wait for the next poll cycle.
   */
  retryRoomPeerConnections(): void {
    if (this.activeEpoch !== this.sessionEpoch) return;
    retryUnconnectedRoomPeers(this.roomDial());
  }

  /** Re-dial one roster peer. Connected peers are left untouched. */
  retryPeerConnection(remoteId: string): void {
    retryRoomPeer(this.roomDial(), remoteId);
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
      if (typeof joined.sessionKey === "string") this.sessionKey = joined.sessionKey;
      await this.prepareRelay();
      await this.onPoll({ peers: joined.peers, messages: [], ticket: joined.ticket });
      this.log("peer-recover-success", { previousPeerId, peerId: this.myId });
    } catch (error) {
      this.log("peer-recover-error", { previousPeerId, error });
      this.options.onUnknownPeer?.();
    } finally {
      this.rejoinInFlight = false;
    }
  }

  join(input: { name: string; peerId?: string }): Promise<{
    peerId: string;
    peers: RtcPeerDescriptor[];
    sessionKey?: string | null;
    limits?: HttpSignalingJoinResult["rtc"];
    ticket?: string;
  }> {
    const key = `${this.options.channel}\0${this.options.room}`;
    return enqueueMeshJoin(key, () => this.joinSerialized(input));
  }

  private async joinSerialized(input: { name: string; peerId?: string }): Promise<{
    peerId: string;
    peers: RtcPeerDescriptor[];
    sessionKey?: string | null;
    limits?: HttpSignalingJoinResult["rtc"];
    ticket?: string;
  }> {
    this.myName = input.name.trim();
    if (!this.myName) throw new Error("Display name is required");
    const epoch = ++this.sessionEpoch;
    this.activeEpoch = epoch;
    this.log("join-request", { room: this.options.room, name: this.myName });
    this.metrics.begin();
    const joined = await this.signalingJoin(input.peerId);
    if (epoch !== this.sessionEpoch) {
      const peerId = joined.peerId ?? input.peerId;
      if (peerId) {
        try {
          await this.options.signaling.leave({
            room: this.options.room,
            peerId,
            sessionKey: joined.sessionKey ?? undefined,
          });
        } catch {
          // The next join must not overlap a peer this attempt already created.
        }
      }
      return { peerId: peerId ?? "", peers: [] };
    }
    this.myId = joined.peerId ?? input.peerId ?? null;
    if (!this.myId) throw new Error("Signaling join did not return peerId");
    if (typeof joined.sessionKey === "string") this.sessionKey = joined.sessionKey;
    await this.prepareRelay();
    if (epoch !== this.sessionEpoch) return { peerId: this.myId, peers: [] };
    this.lastRosterSig = null;
    this.log("join-response", {
      peerId: this.myId,
      roster: joined.peers.map((peer) => ({ id: peer.id, name: peer.name, user: peer.user })),
    });
    this.visibilityUnsubscribe ??=
      this.visibility?.subscribe(() => this.pollLoop.onVisibilityChange()) ?? null;
    this.schedulePoll();
    await this.onPoll({ peers: joined.peers, messages: [], ticket: joined.ticket });
    this.installNetworkRecovery();
    return {
      peerId: this.myId,
      peers: joined.peers,
      sessionKey: joined.sessionKey,
      limits: joined.rtc,
      ticket: joined.ticket,
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
      onIceRestart: () => this.metrics.noteIceRestart(),
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
    // Admit drops the knocker name. Mint force-relay TURN now, before this
    // poll creates the first peer connection. A lobby precheck was denied.
    await this.prepareRelay();
    await this.onPoll({ peers: joined.peers, messages: [], ticket: joined.ticket });
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
    this.sessionEpoch += 1;
    this.metrics.flush();
    this.stopPolling();
    this.pollLoop.release();
    this.networkUnsubscribe?.();
    this.networkUnsubscribe = null;
    this.meshRelay?.dispose();
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
