import { applyRtcDebugOverrides } from "@/lib/rtc/force-relay";
import { getLinkChannelClient } from "@/lib/rtc/link/link-channel-client";
import type {
  LinkChannelClient,
  LinkRoomListener,
  LinkTrust,
  PeerChannelState,
} from "@/lib/rtc/link/link-channel-types";
import { rtcLog } from "@/lib/rtc/log";
import { createDataBinding } from "@/lib/rtc/session/bindings";
import { createRtcSession } from "@/lib/rtc/session/create-rtc-session";
import type { RtcPeerMesh } from "@/lib/rtc/session/peer-mesh";
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
  normalizeDocsCollabAccess,
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
import type {
  DocsCollabMeshMessage,
  DocsCollabMeshPeer,
  DocsCollabMeshPeerStatus,
  DocsCollabPeerLinkState,
} from "@/text-editor-core/docs-collab/docs-collab-types";
import {
  collabRoomKey,
  decodeCollabTicketPayload,
  type DocsCollabTicketJwk,
} from "@/text-editor-core/docs-collab/docs-collab-ticket";
import { collabErrorStatus } from "@/text-editor-core/docs-collab/docs-collab-utils";

const DC_LABEL = "collab";

function hexBytes(bytes: readonly number[], start: number, end: number): string {
  let out = "";
  for (let i = start; i < end; i += 1) {
    out += (bytes[i]! & 0xff).toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * First and last 8 bytes of a collab payload, so a send and its receive match
 * without putting anything new on the wire. Shorter payloads are hexed once.
 */
export function tagOf(msg: DocsCollabMeshMessage | { u?: readonly number[] }): string {
  const bytes = "u" in msg ? msg.u : undefined;
  if (!bytes || bytes.length === 0) return "";
  if (bytes.length < 16) return hexBytes(bytes, 0, bytes.length);
  return hexBytes(bytes, 0, 8) + hexBytes(bytes, bytes.length - 8, bytes.length);
}

function payloadBytes(msg: DocsCollabMeshMessage): number {
  return msg.type === "sync" || msg.type === "awareness" ? msg.u.length : 0;
}

const liveCollabSessions = new Map<string, Set<DocsRtcSession>>();

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
  linkClient?: LinkChannelClient;
  getYDoc?: () => import("yjs").Doc | null;
  /** When false, outbound Yjs HTTP/mesh document sync stays muted until bootstrap finishes. */
  meshHydrated?: () => boolean;
};

export class DocsRtcSession {
  private readonly room: string;

  private myName = "";

  private readonly listeners = new Set<MeshListener>();

  private readonly knownRosterIds = new Set<string>();

  private loggedFirstSync = false;

  private loggedFirstAwareness = false;

  private readonly mesh: RtcPeerMesh;

  private readonly links: LinkChannelClient;

  private readonly publishedJwk: DocsCollabTicketJwk | null;

  /** Rights the server resolved, for link-channel peers and for us. */
  private readonly trust = new DocsCollabRosterTrust();

  private readonly pollIntervals: RtcPollIntervals = {
    connectingMs: DEFAULT_RTC_POLL_INTERVALS.connectingMs,
    steadyMs: DEFAULT_RTC_POLL_INTERVALS.steadyMs,
  };

  private rosterPeers: RtcPeerDescriptor[] = [];

  private readonly http: DocsCollabHttpSync | null;

  /** Latest ticket from join or poll, published on the link room. */
  private ownTicket: string | undefined;

  private roomKey: string | null = null;

  private unsubscribeLinks: (() => void) | null = null;

  private states = new Map<string, PeerChannelState>();

  private readonly linkListener: LinkRoomListener = {
    onMessage: (from, msg, trust) => this.onLinkMessage(from, msg, trust),
    onState: (states) => this.onLinkState(states),
    onNeedRoster: () => this.mesh.kickPoll(),
  };

  constructor(private readonly options: DocsRtcSessionOptions) {
    this.room = options.room;
    this.links = options.linkClient ?? getLinkChannelClient();
    this.publishedJwk = collabJwkFromPublication(options.collabTicket);

    this.mesh = createRtcSession({
      channel: "collab",
      room: options.room,
      rtcSettings: applyRtcDebugOverrides(this.options.rtcSettings),
      binding: createDataBinding({ label: DC_LABEL }),
      iceCandidatePoolSize: 2,
      pollIntervals: this.pollIntervals,
      signaling: {
        apiBase: options.apiBase,
        getAuth: () => ({ bearerToken: options.authToken }),
      },
      shouldConnectToPeer: () => false,
      shouldAcceptOffer: () => false,
      recoverOnUnknownPeer: true,
      onLinkChange: () => this.emit({ type: "link" }),
      onSendFailed: (remoteId) => this.emit({ type: "resync", from: remoteId }),
      onPollError: (error) => {
        if (collabErrorStatus(error) !== 403) return;
        if (this.roomKey) this.links.removeRoom(this.roomKey);
        this.trust.forget();
        this.emit({ type: "forbidden" });
      },
      onPollData: (data) => {
        this.rosterPeers = data.peers;
        this.trust.remember(data.peers, this.mesh.getMyId());
        this.noteOwnAccessFromPoll(data);
        this.gossipNewRosterPeers(data.peers);
        const messages = mailboxMessages(data);
        if (
          this.roomKey &&
          messages.some((message) => this.states.get(message.from)?.out !== true)
        ) {
          this.links.kick(this.roomKey);
        }
        this.http?.ingest(messages);
        this.http?.evaluate();
        this.publishRoom();
      },
    });
    this.http = options.getYDoc
      ? new DocsCollabHttpSync({
          now: () => Date.now(),
          peers: () => this.httpRoster(),
          webrtcUnavailable: () => !this.links.available(),
          send: (to, type, payload) => {
            void this.mesh.sendMailbox(to, type, payload).catch(() => {
              // A refused post usually means a stale roster. Poll now instead of failing loudly.
              this.mesh.kickPoll();
            });
          },
          sendStateVectorOnChannel: (peerId) => this.sendChannelStateVector(peerId),
          requestRelay: () => Promise.resolve({ outcome: "relay_unavailable" } as const),
          onRelay: () => undefined,
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
          meshHydrated: options.meshHydrated,
        })
      : null;
  }

  /**
   * Join and poll responses carry this client's ticket. The roster omits self,
   * so without this the broadcast mute stays at the default `read` and an
   * editor never puts a document update on the wire.
   */
  private noteOwnAccessFromPoll(data: { ticket?: string }): void {
    const ticket = data.ticket;
    if (!ticket) return;
    const changed = ticket !== this.ownTicket;
    this.ownTicket = ticket;
    const payload = decodeCollabTicketPayload(ticket);
    if (payload) {
      const myPeerId = this.mesh.getMyId();
      if (!myPeerId || payload.peer === myPeerId) {
        this.trust.noteOwnAccess(payload.access);
      }
    }
    if (changed) this.publishRoom();
  }

  private publishRoom(): void {
    if (!this.roomKey) return;
    const myPeerId = this.mesh.getMyId();
    if (!myPeerId) return;
    this.links.setRoom({
      kind: "collab",
      roomKey: this.roomKey,
      myPeerId,
      ticket: this.ownTicket,
      jwk: this.publishedJwk,
      roster: this.rosterPeers
        .filter((peer) => typeof peer.user === "string" && peer.user !== "")
        .map((peer) => ({
          id: peer.id,
          user: peer.user!,
          access: normalizeDocsCollabAccess(peer.access ?? "read"),
        })),
    });
  }

  private httpRoster(): Array<{
    id: string;
    name: string;
    caps?: RtcPeerDescriptor["caps"];
    connected: boolean;
  }> {
    const mine = this.mesh.getMyId();
    return this.rosterPeers
      .filter((peer) => peer.id !== mine)
      .map((peer) => ({
        id: peer.id,
        name: peer.name,
        caps: peer.caps,
        connected: this.states.get(peer.id)?.out === true,
      }));
  }

  private sendChannelStateVector(peerId: string): void {
    const doc = this.options.getYDoc?.();
    if (!doc) return;
    this.sendTo(peerId, { type: "sync", u: encodeSyncStep1(doc) });
  }

  private emit(msg: DocsCollabMeshMessage): void {
    for (const listener of this.listeners) listener(msg);
  }

  private onLinkMessage(from: string, msg: unknown, trust: LinkTrust): void {
    if (!msg || typeof msg !== "object") return;
    const typed = msg as DocsCollabMeshMessage;
    if (!typed.type) return;
    rtcLog({ channel: "collab", peerId: this.mesh.getMyId() }, "dc-recv", {
      from,
      type: typed.type,
      bytes: payloadBytes(typed),
      tag: tagOf(typed),
    });
    if (typed.type === "peer-hint") {
      this.mesh.kickPoll();
      return;
    }
    if (typed.type === "sync" && !this.loggedFirstSync) {
      this.loggedFirstSync = true;
      rtcLog({ channel: "collab", peerId: this.mesh.getMyId() }, "first-remote-sync", {
        from,
        bytes: Array.isArray(typed.u) ? typed.u.length : 0,
      });
    }
    if (typed.type === "awareness" && !this.loggedFirstAwareness) {
      this.loggedFirstAwareness = true;
      rtcLog({ channel: "collab", peerId: this.mesh.getMyId() }, "first-remote-awareness", {
        from,
      });
    }
    this.emit({ ...(typed as DocsCollabMeshMessage), from, trust } as DocsCollabMeshMessage);
  }

  private onLinkState(states: ReadonlyMap<string, PeerChannelState>): void {
    const previous = this.states;
    this.states = new Map(states);
    for (const [remoteId, state] of this.states) {
      const live = state.out && state.in;
      const wasLive = previous.get(remoteId)?.out === true && previous.get(remoteId)?.in === true;
      if (!live || wasLive) continue;
      rtcLog({ channel: "collab", peerId: this.mesh.getMyId() }, "dc-open", {
        remoteId,
        via: "link",
      });
      this.emit({ type: "dc-open", from: remoteId });
    }
    this.emit({ type: "link" });
    this.http?.evaluate();
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

  private peerLinkState(peer: RtcPeerDescriptor): DocsCollabPeerLinkState {
    const state = this.states.get(peer.id);
    if (state?.out && state.in) return "connected";
    if (peer.caps?.includes("yjs-http")) return "server";
    return "connecting";
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
    return this.getRoomPeers().map((peer) => peer.id);
  }

  getRoomPeers(): DocsCollabMeshPeer[] {
    const mine = this.mesh.getMyId();
    return this.rosterPeers
      .filter((peer) => peer.id !== mine)
      .map((peer) => ({ id: peer.id, name: peer.name }));
  }

  getRoomPeerStatuses(): DocsCollabMeshPeerStatus[] {
    const mine = this.mesh.getMyId();
    return this.rosterPeers
      .filter((peer) => peer.id !== mine)
      .map((peer) => ({
        id: peer.id,
        name: peer.name,
        link: this.peerLinkState(peer),
      }));
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
    rtcLog({ channel: "collab", peerId: this.mesh.getMyId() }, "dc-send", {
      type: msg.type,
      bytes: payloadBytes(msg),
      tag: tagOf(msg),
    });
    if (this.roomKey) this.links.broadcast(this.roomKey, msg);
  }

  sendTo(remoteId: string, msg: DocsCollabMeshMessage): void {
    if (this.isMutedDocumentUpdate(msg, remoteId)) return;
    rtcLog({ channel: "collab", peerId: this.mesh.getMyId() }, "dc-send", {
      type: msg.type,
      bytes: payloadBytes(msg),
      tag: tagOf(msg),
    });
    if (this.roomKey) this.links.send(this.roomKey, remoteId, msg);
  }

  /**
   * Transport guard behind the read-only UI: a viewer never puts a document
   * update on the wire, so a tampered client cannot push one either. A sync
   * step 1 still goes out — it only asks for state, which is what a viewer is
   * here for. Awareness and roster gossip flow too; presence is not a change.
   */
  private isMutedDocumentUpdate(msg: DocsCollabMeshMessage, remoteId?: string): boolean {
    if (msg.type !== "sync" || !isDocumentBearingSyncMessage(msg.u)) return false;
    if (docsCollabAccessMayBroadcast(this.trust.myAccess())) return false;
    rtcLog({ channel: "collab", peerId: this.mesh.getMyId() }, "update-not-sent", {
      remoteId: remoteId ?? null,
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
    this.noteOwnAccessFromPoll(joined);
    this.roomKey = await collabRoomKey(this.room);
    this.unsubscribeLinks?.();
    this.unsubscribeLinks = this.links.subscribe(this.roomKey, this.linkListener);
    this.publishRoom();
    const live = liveCollabSessions.get(this.room) ?? new Set<DocsRtcSession>();
    live.add(this);
    liveCollabSessions.set(this.room, live);
    if (live.size > 1) {
      rtcLog({ channel: "collab", peerId: this.mesh.getMyId() }, "duplicate-session", {
        room: this.room,
        ids: [...live].map((session) => session.mesh.getMyId()),
      });
    }
    this.http?.start();
    return { peerId: joined.peerId, peers: joined.peers };
  }

  async leave(): Promise<void> {
    liveCollabSessions.get(this.room)?.delete(this);
    this.http?.stop();
    this.unsubscribeLinks?.();
    this.unsubscribeLinks = null;
    if (this.roomKey) this.links.removeRoom(this.roomKey);
    this.roomKey = null;
    this.states = new Map();
    await this.mesh.leave();
    this.myName = "";
  }
}
