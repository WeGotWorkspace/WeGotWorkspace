import { rtcLog } from "@/lib/rtc/log";
import { peekNetClass } from "@/lib/rtc/net-probe";
import { createDataBinding } from "@/lib/rtc/session/bindings";
import { createRtcSession } from "@/lib/rtc/session/create-rtc-session";
import type { RtcPeerMesh } from "@/lib/rtc/session/peer-mesh";
import type { PrincipalLinkRegistry } from "@/lib/rtc/session/principal-link-registry";
import { needsRelayPrecheck } from "@/lib/rtc/session/relay-policy";
import { requestRelay, type RelayRequestOutcome } from "@/lib/rtc/session/relay-request";
import {
  DEFAULT_RTC_POLL_INTERVALS,
  type RtcPeerDescriptor,
  type RtcPollIntervals,
  type RtcSettings,
} from "@/lib/rtc/types";
import type { PublishedCollabTicket } from "@/lib/api/wgw/rtc";
import {
  type DocsCollabAccess,
  DocsCollabRosterTrust,
  docsCollabAccessMayBroadcast,
} from "@/text-editor-core/docs-collab/docs-collab-access";
import {
  DocsCollabHttpSync,
  type DocsHttpMailboxMessage,
} from "@/text-editor-core/docs-collab/docs-collab-http-sync";
import {
  encodeSyncStep1,
  isDocumentBearingSyncMessage,
} from "@/text-editor-core/docs-collab/docs-collab-mesh-sync";
import { YJS_HTTP_POLL_MS } from "@/text-editor-core/docs-collab/docs-collab-http-wire";
import { DocsCollabPrincipalReuse } from "@/text-editor-core/docs-collab/docs-collab-principal-reuse";
import type {
  DocsCollabMeshMessage,
  DocsCollabMeshPeer,
  DocsCollabMeshPeerStatus,
} from "@/text-editor-core/docs-collab/docs-collab-types";
import {
  createCollabTicketKeyCache,
  decodeCollabTicketPayload,
  type DocsCollabTicketJwk,
} from "@/text-editor-core/docs-collab/docs-collab-ticket";
import { collabErrorStatus } from "@/text-editor-core/docs-collab/docs-collab-utils";

const DC_LABEL = "collab";

type MeshListener = (msg: DocsCollabMeshMessage) => void;

function mailboxMessages(data: unknown): DocsHttpMailboxMessage[] {
  if (!data || typeof data !== "object" || !("messages" in data)) return [];
  const messages = (data as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) return [];
  const rows: DocsHttpMailboxMessage[] = [];
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const row = message as { from?: unknown; type?: unknown; payload?: unknown };
    if (typeof row.from !== "string" || typeof row.type !== "string") continue;
    rows.push({ from: row.from, type: row.type, payload: row.payload });
  }
  return rows;
}

/** Validate a peer-hint payload from the wire; drops malformed entries. */
export function parsePeerHintPeers(value: unknown): DocsCollabMeshPeer[] {
  if (!Array.isArray(value)) return [];
  const peers: DocsCollabMeshPeer[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const { id, name } = entry as { id?: unknown; name?: unknown };
    if (typeof id !== "string" || id === "" || typeof name !== "string") continue;
    peers.push({ id, name });
  }
  return peers;
}

export type DocsRelayNotice = {
  name: string;
  outcome: RelayRequestOutcome["outcome"];
};

/** Public JWK from room configuration, or null when the publication is incomplete. */
function collabJwkFromPublication(
  published: PublishedCollabTicket | undefined,
): DocsCollabTicketJwk | null {
  if (!published) return null;
  const { jwk, kid } = published;
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || jwk.kid !== kid || jwk.x === "" || jwk.y === "") {
    return null;
  }
  return {
    kty: jwk.kty,
    crv: jwk.crv,
    x: jwk.x,
    y: jwk.y,
    kid: jwk.kid,
    alg: jwk.alg,
    use: jwk.use,
  };
}

export type DocsRtcSessionOptions = {
  apiBase: string;
  room: string;
  authToken?: string;
  rtcSettings: RtcSettings;
  /** Public C2 key from room configuration. Absent on older servers. */
  collabTicket?: PublishedCollabTicket;
  /** Injected in tests; the live app uses the suite-level singleton. */
  reuseRegistry?: PrincipalLinkRegistry;
  getYDoc?: () => import("yjs").Doc | null;
  onRelayNotice?: (notice: DocsRelayNotice) => void;
};

export class DocsRtcSession {
  private myName = "";

  private readonly listeners = new Set<MeshListener>();

  private readonly knownRosterIds = new Set<string>();

  private loggedFirstSync = false;

  private loggedFirstAwareness = false;

  private readonly mesh: RtcPeerMesh;

  private readonly reuse: DocsCollabPrincipalReuse;

  /** Collab peer ids that have appeared in a signaling roster while reused. */
  private readonly seenReusedRosterIds = new Set<string>();

  /** Rights the server resolved, for direct data-channel peers and for us. */
  private readonly trust = new DocsCollabRosterTrust();

  private readonly pollIntervals: RtcPollIntervals = {
    connectingMs: DEFAULT_RTC_POLL_INTERVALS.connectingMs,
    steadyMs: DEFAULT_RTC_POLL_INTERVALS.steadyMs,
  };

  private readonly relayReady = new Set<string>();

  private readonly httpOnlyUntilRelay: boolean;

  private rosterPeers: RtcPeerDescriptor[] = [];

  private readonly http: DocsCollabHttpSync | null;

  /** Latest ticket from join or poll, sent on reuse `open` and `ack`. */
  private ownTicket: string | undefined;

  /** Outbound tickets stay off the wire until a published JWK can verify them. */
  private readonly sendTicket: boolean;

  constructor(private readonly options: DocsRtcSessionOptions) {
    this.httpOnlyUntilRelay = options.rtcSettings.forceRelay && !options.rtcSettings.turnAvailable;
    const binding = createDataBinding({
      label: DC_LABEL,
      onOpen: (remoteId) => {
        rtcLog({ channel: "collab", peerId: this.mesh.getMyId() }, "datachannel-open", {
          remoteId,
          reused: false,
        });
        this.emit({ type: "dc-open", from: remoteId });
        this.http?.evaluate();
      },
      onMessage: (remoteId, data) => {
        try {
          const msg = JSON.parse(data) as DocsCollabMeshMessage;
          if (!msg || typeof msg !== "object") return;
          if (msg.type === "peer-hint") {
            this.mesh.applyPeerHint(parsePeerHintPeers(msg.peers));
            return;
          }
          if (msg.type === "sync" && !this.loggedFirstSync) {
            this.loggedFirstSync = true;
            rtcLog({ channel: "collab", peerId: this.mesh.getMyId() }, "first-remote-sync", {
              from: remoteId,
              bytes: Array.isArray(msg.u) ? msg.u.length : 0,
            });
          }
          if (msg.type === "awareness" && !this.loggedFirstAwareness) {
            this.loggedFirstAwareness = true;
            rtcLog({ channel: "collab", peerId: this.mesh.getMyId() }, "first-remote-awareness", {
              from: remoteId,
            });
          }
          // A direct collab data channel takes its rights from the server
          // roster — the peer's own claim is not part of the message.
          this.emit({
            ...msg,
            from: remoteId,
            trust: {
              user: this.trust.userForPeerId(remoteId),
              access: this.trust.accessForPeerId(remoteId),
            },
          } as DocsCollabMeshMessage);
        } catch {
          // ignore malformed payloads
        }
      },
      onClose: () => this.emit({ type: "link" }),
    });

    const publishedJwk = collabJwkFromPublication(options.collabTicket);
    this.sendTicket = publishedJwk !== null;
    const resolveTicketKey = publishedJwk
      ? createCollabTicketKeyCache(async (kid) => (kid === publishedJwk.kid ? publishedJwk : null))
      : async () => null;
    if (publishedJwk) void resolveTicketKey(publishedJwk.kid);

    this.reuse = new DocsCollabPrincipalReuse({
      room: options.room,
      registry: options.reuseRegistry,
      getMyCollabPeerId: () => this.mesh.getMyId(),
      getMyName: () => this.myName,
      onDcOpen: (remoteId) => {
        this.emit({ type: "dc-open", from: remoteId });
        this.http?.evaluate();
      },
      onReuseFallback: () => this.mesh.retryRoomPeerConnections(),
      onReuseAttached: (remoteId) => this.mesh.abortPeerConnection(remoteId),
      onLinkChange: () => this.emit({ type: "link" }),
      onMessage: (msg) => this.handleReuseMeshMessage(msg),
      onSendFailed: (remoteId) => this.emit({ type: "resync", from: remoteId }),
      resolveTicketKey,
      getOwnTicket: () => (this.sendTicket ? this.ownTicket : undefined),
    });

    this.mesh = createRtcSession({
      channel: "collab",
      room: options.room,
      rtcSettings: options.rtcSettings,
      binding,
      iceCandidatePoolSize: 2,
      pollIntervals: this.pollIntervals,
      signaling: {
        apiBase: options.apiBase,
        getAuth: () => ({ bearerToken: options.authToken }),
      },
      shouldConnectToPeer: (peer) => {
        if (this.httpOnlyUntilRelay && !this.relayReady.has(peer.id)) return false;
        return !this.reuse.shouldSkipIce(peer);
      },
      shouldAcceptOffer: (from) => !this.reuse.shouldIgnoreOffer(from),
      onLinkChange: () => this.emit({ type: "link" }),
      // Contract C2 revocation: the poll re-reads the share grant, so a 403
      // means read access is gone. Drop the reuse links so the other peers
      // stop treating this client as a collaborator, and tell the session.
      onSendFailed: (remoteId) => this.emit({ type: "resync", from: remoteId }),
      onPollError: (error) => {
        if (collabErrorStatus(error) !== 403) return;
        this.trust.forget();
        this.reuse.considerRoster([], this.mesh.getMyId());
        this.emit({ type: "forbidden" });
      },
      onPollData: (data) => {
        this.rosterPeers = data.peers;
        this.trust.remember(data.peers, this.mesh.getMyId());
        this.noteOwnAccessFromPoll(data);
        this.reuse.considerRoster(data.peers, this.mesh.getMyId());
        this.dropStaleReusedPeers(data.peers);
        this.gossipNewRosterPeers(data.peers);
        const messages = mailboxMessages(data);
        this.http?.ingest(messages);
        this.http?.evaluate();
      },
    });
    this.http = options.getYDoc
      ? new DocsCollabHttpSync({
          now: () => Date.now(),
          peers: () => this.httpRoster(),
          webrtcUnavailable: () => this.webrtcUnavailable(),
          send: (to, type, payload) => {
            void this.mesh.sendMailbox(to, type, payload).catch(() => {
              // A refused mailbox post must not surface as an unhandled rejection.
            });
          },
          sendStateVectorOnChannel: (peerId) => this.sendChannelStateVector(peerId),
          requestRelay: (peerId, reason) => this.requestPeerRelay(peerId, reason),
          onRelay: (peerId, name, outcome) => {
            if (outcome.outcome === "issued") {
              this.relayReady.add(peerId);
              this.mesh.retryPeerWithRelay(peerId, outcome.turn);
            }
            this.options.onRelayNotice?.({ name, outcome: outcome.outcome });
          },
          setFastPoll: (active) => {
            this.pollIntervals.steadyMs = active
              ? YJS_HTTP_POLL_MS
              : DEFAULT_RTC_POLL_INTERVALS.steadyMs;
            this.pollIntervals.connectingMs = Math.min(
              this.pollIntervals.connectingMs,
              YJS_HTTP_POLL_MS,
            );
            if (active) this.pollIntervals.maxDelayMs = YJS_HTTP_POLL_MS;
            else delete this.pollIntervals.maxDelayMs;
            this.mesh.kickPoll();
          },
          getYDoc: () => options.getYDoc?.() ?? null,
          trust: (peerId) => ({
            user: this.trust.userForPeerId(peerId),
            access: this.trust.accessForPeerId(peerId),
          }),
          myAccess: () => this.myAccess(),
        })
      : null;
  }

  /**
   * Join and poll responses carry this client's ticket. The roster omits self,
   * so without this the broadcast mute stays at the default `read` and an
   * editor never puts a document update on the wire. The same string rides
   * on outbound reuse `open` and `ack` once a JWK was published.
   */
  private noteOwnAccessFromPoll(data: { ticket?: string }): void {
    const ticket = data.ticket;
    if (!ticket) return;
    this.ownTicket = ticket;
    const payload = decodeCollabTicketPayload(ticket);
    if (!payload) return;
    const myPeerId = this.mesh.getMyId();
    if (myPeerId && payload.peer !== myPeerId) return;
    this.trust.noteOwnAccess(payload.access);
  }

  private webrtcUnavailable(): boolean {
    if (this.httpOnlyUntilRelay) return true;
    return needsRelayPrecheck(this.mesh.localNetClass() ?? peekNetClass() ?? undefined);
  }

  private httpRoster(): Array<{
    id: string;
    name: string;
    caps?: RtcPeerDescriptor["caps"];
    connected: boolean;
  }> {
    const connected = new Set(
      this.getRoomPeerStatuses()
        .filter((peer) => peer.link === "connected")
        .map((peer) => peer.id),
    );
    const mine = this.mesh.getMyId();
    return this.rosterPeers
      .filter((peer) => peer.id !== mine)
      .map((peer) => ({
        id: peer.id,
        name: peer.name,
        caps: peer.caps,
        connected: connected.has(peer.id),
      }));
  }

  private requestPeerRelay(
    peerId: string,
    reason: "timeout" | "refresh" = "timeout",
  ): Promise<RelayRequestOutcome> {
    const peerIdLocal = this.mesh.getMyId();
    if (!peerIdLocal) return Promise.resolve({ outcome: "error", error: "not_joined" });
    const net = this.mesh.localNetClass() ?? peekNetClass() ?? undefined;
    return requestRelay(
      {
        postRelay: (_roomId, body) => this.mesh.postRelay(body),
      },
      {
        roomId: this.options.room,
        peerId: peerIdLocal,
        target: peerId,
        reason,
        ...(net ? { net } : {}),
      },
    );
  }

  private sendChannelStateVector(peerId: string): void {
    const doc = this.options.getYDoc?.();
    if (!doc) return;
    this.sendTo(peerId, { type: "sync", u: encodeSyncStep1(doc) });
  }

  private emit(msg: DocsCollabMeshMessage): void {
    for (const listener of this.listeners) listener(msg);
  }

  private handleReuseMeshMessage(msg: DocsCollabMeshMessage): void {
    if (msg.type === "peer-hint") {
      this.mesh.applyPeerHint(parsePeerHintPeers(msg.peers));
      return;
    }
    if (msg.type === "sync" && !this.loggedFirstSync) {
      this.loggedFirstSync = true;
      rtcLog({ channel: "collab", peerId: this.mesh.getMyId() }, "first-remote-sync", {
        from: msg.from,
        bytes: Array.isArray(msg.u) ? msg.u.length : 0,
        reused: true,
      });
    }
    if (msg.type === "awareness" && !this.loggedFirstAwareness) {
      this.loggedFirstAwareness = true;
      rtcLog({ channel: "collab", peerId: this.mesh.getMyId() }, "first-remote-awareness", {
        from: msg.from,
        reused: true,
      });
    }
    this.emit(msg);
  }

  private dropStaleReusedPeers(rosterPeers: RtcPeerDescriptor[]): void {
    const roomIds = new Set(rosterPeers.map((peer) => peer.id));
    for (const extra of this.reuse.extraPeers()) {
      if (roomIds.has(extra.id)) this.seenReusedRosterIds.add(extra.id);
    }
    for (const id of [...this.seenReusedRosterIds]) {
      if (roomIds.has(id)) continue;
      this.seenReusedRosterIds.delete(id);
      this.reuse.dropPeer(id, true);
    }
  }

  /**
   * Gossip discovery send side: when a roster poll reveals peers we have not
   * seen before, forward them over the already-open data channels so connected
   * peers do not wait out their own idle poll cycle. Best effort — peers
   * without an open channel simply rely on their normal poll.
   */
  private gossipNewRosterPeers(rosterPeers: DocsCollabMeshPeer[]): void {
    const myId = this.mesh.getMyId();
    const others = rosterPeers.filter((peer) => peer.id !== myId);
    const added = others.filter((peer) => !this.knownRosterIds.has(peer.id));
    this.knownRosterIds.clear();
    for (const peer of others) this.knownRosterIds.add(peer.id);
    if (added.length === 0) return;
    this.broadcast({
      type: "peer-hint",
      peers: added.map(({ id, name }) => ({ id, name })),
    });
  }

  onMessage(listener: MeshListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Drop all message listeners, e.g. when the owning mount lingers the session. */
  clearMessageListeners(): void {
    this.listeners.clear();
  }

  getMyId(): string | null {
    return this.mesh.getMyId();
  }

  getMyName(): string {
    return this.myName;
  }

  getPeerIds(): string[] {
    const ids = new Set(this.mesh.getPeerIds());
    for (const peer of this.reuse.extraPeers()) ids.add(peer.id);
    return [...ids];
  }

  getRoomPeers(): DocsCollabMeshPeer[] {
    const byId = new Map<string, DocsCollabMeshPeer>();
    for (const peer of this.mesh.getRoomPeers()) {
      byId.set(peer.id, { id: peer.id, name: peer.name });
    }
    for (const peer of this.reuse.extraPeers()) {
      if (!byId.has(peer.id)) byId.set(peer.id, peer);
    }
    return [...byId.values()];
  }

  getRoomPeerStatuses(): DocsCollabMeshPeerStatus[] {
    return this.reuse.overlayStatuses(
      this.mesh.getPeerLinkStates().map((peer) => ({
        id: peer.id,
        name: peer.name,
        link: peer.link as DocsCollabMeshPeerStatus["link"],
      })),
    );
  }

  linkCount(): number {
    return this.getRoomPeerStatuses().filter((peer) => peer.link === "connected").length;
  }

  /** Right the server resolved for this client, from its own roster row. */
  myAccess(): DocsCollabAccess {
    return this.trust.myAccess();
  }

  broadcast(msg: DocsCollabMeshMessage): void {
    if (this.isMutedDocumentUpdate(msg)) return;
    this.reuse.broadcast(msg);
    this.mesh.broadcastJson(msg);
  }

  sendTo(remoteId: string, msg: DocsCollabMeshMessage): void {
    if (this.isMutedDocumentUpdate(msg)) return;
    if (this.reuse.sendTo(remoteId, msg)) return;
    this.mesh.sendJsonTo(remoteId, msg);
  }

  /**
   * Transport guard behind the read-only UI: a viewer never puts a document
   * update on the wire, so a tampered client cannot push one either. A sync
   * step 1 still goes out — it only asks for state, which is what a viewer is
   * here for. Awareness and roster gossip flow too; presence is not a change.
   */
  private isMutedDocumentUpdate(msg: DocsCollabMeshMessage): boolean {
    if (msg.type !== "sync" || !isDocumentBearingSyncMessage(msg.u)) return false;
    if (docsCollabAccessMayBroadcast(this.trust.myAccess())) return false;
    rtcLog({ channel: "collab", peerId: this.mesh.getMyId() }, "update-not-sent", {
      access: this.trust.myAccess(),
      reason: "reader",
    });
    return true;
  }

  /** Local Yjs update. Data-channel broadcast stays with the caller. */
  noteLocalUpdate(update: Uint8Array): void {
    if (!docsCollabAccessMayBroadcast(this.trust.myAccess())) return;
    this.http?.noteLocalUpdate(update);
  }

  async join(name: string): Promise<{ peerId: string; peers: DocsCollabMeshPeer[] }> {
    this.myName = name.trim();
    const joined = await this.mesh.join({ name: this.myName });
    this.http?.start();
    return { peerId: joined.peerId, peers: joined.peers };
  }

  async leave(): Promise<void> {
    this.http?.stop();
    this.reuse.dispose();
    this.seenReusedRosterIds.clear();
    await this.mesh.leave();
    this.myName = "";
  }
}
