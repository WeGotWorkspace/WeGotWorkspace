import { rtcLog } from "@/lib/rtc/log";
import type { CollabReuseEnvelope } from "@/lib/rtc/session/collab-reuse-envelope";
import {
  getPrincipalLinkRegistry,
  type PrincipalLinkRegistry,
} from "@/lib/rtc/session/principal-link-registry";
import type { RtcPeerDescriptor } from "@/lib/rtc/types";
import {
  DocsCollabRosterTrust,
  tighterDocsCollabAccess,
  type DocsCollabAccess,
} from "@/text-editor-core/docs-collab/docs-collab-access";
import {
  collabRoomKey,
  verifyCollabTicket,
} from "@/text-editor-core/docs-collab/docs-collab-ticket";
import type {
  DocsCollabMeshMessage,
  DocsCollabMeshPeer,
  DocsCollabMeshPeerStatus,
} from "@/text-editor-core/docs-collab/docs-collab-types";

/**
 * Wait this long for an `ack` before falling back to a fresh collab ICE handshake.
 * The responder verifies a ticket asynchronously, and the principal channel has
 * often only just opened.
 */
export const COLLAB_REUSE_ACK_TIMEOUT_MS = 1500;

/** Hold a signed ticket this long while the roster poll catches up. Stays under the ack timeout. */
export const COLLAB_REUSE_ROSTER_WAIT_MS = 1_000;

const MAX_ROSTER_WAITERS = 8;

/** Brief hold before fresh ICE when the principal mesh is still connecting. */
export const COLLAB_REUSE_PRINCIPAL_CONNECT_DEFER_MS = 400;

type ReusedPeer = {
  collabPeerId: string;
  name: string;
  username: string;
  principalPeerId: string;
};

type PendingPeer = {
  collabPeerId: string;
  name: string;
  username: string;
  /** Principal peers the `open` was sent to, so ack-timeout can close that half-attach. */
  principalPeerIds: string[];
  timer: ReturnType<typeof setTimeout>;
};

type DeferredFreshIce = {
  collabPeerId: string;
  username: string;
  timer: ReturnType<typeof setTimeout>;
};

export type DocsCollabPrincipalReusePorts = {
  room: string;
  registry?: PrincipalLinkRegistry;
  getMyCollabPeerId: () => string | null;
  getMyName: () => string;
  onDcOpen: (collabPeerId: string) => void;
  onLinkChange: () => void;
  /**
   * Principal reuse ended — dial fresh ICE for this collab peer.
   * Omit the id only when the caller cannot name the peer (full roster retry).
   * Not called on successful reuse attach.
   */
  onReuseFallback?: (collabPeerId?: string) => void;
  /** Tear down an in-flight collab ICE handshake once reuse wins for this peer. */
  onReuseAttached?: (collabPeerId: string) => void;
  onMessage: (msg: DocsCollabMeshMessage) => void;
  /** Principal data-channel send failed for a reused collab peer. */
  onSendFailed?: (collabPeerId: string) => void;
  /** Imported C2 public key for a `kid`. Missing keys reject a presented ticket. */
  resolveTicketKey?: (kid: string) => Promise<CryptoKey | null>;
  /** This client's own ticket, attached to outbound `open` and `ack` when set. */
  getOwnTicket?: () => string | undefined;
  /** Ask the collab session for an immediate roster poll. */
  requestRosterRefresh?: () => void;
  /** Clock for ticket expiry. Tests pin it; production uses the wall clock. */
  nowSeconds?: () => number;
  ackTimeoutMs?: number;
  principalConnectDeferMs?: number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
};

/**
 * Attaches a collab room onto live principal data channels (`collab-reuse`
 * envelopes). Call `considerRoster` from the collab poll callback *before*
 * `shouldConnectToPeer` so reuse-hit peers skip ICE.
 *
 * The principal `workspace` room holds every signed-in account, so an envelope
 * arriving on it says nothing about document access. A present C2 ticket is
 * verified for identity. A rostered peer's right is the tighter of that ticket
 * and the live roster row. An unrostered peer is dropped. An envelope with no
 * ticket is still gated by the collab roster, so a mixed-version room keeps
 * syncing. An unrostered `open` that also has no ticket is dropped without an
 * `ack`.
 */
export class DocsCollabPrincipalReuse {
  private readonly room: string;

  private readonly registry: PrincipalLinkRegistry;

  private readonly ackTimeoutMs: number;

  private readonly principalConnectDeferMs: number;

  private readonly scheduleTimeout: typeof setTimeout;

  private readonly cancelTimeout: typeof clearTimeout;

  private readonly unsubscribe: () => void;

  private readonly unsubscribeLinks: () => void;

  private readonly unsubscribeLinkOpen: () => void;

  private readonly unsubscribeSendFailed: () => void;

  private readonly pending = new Map<string, PendingPeer>();

  private readonly deferredFreshIce = new Map<string, DeferredFreshIce>();

  private readonly reused = new Map<string, ReusedPeer>();

  private readonly failedUsernames = new Set<string>();

  private readonly loggedMiss = new Set<string>();

  /** Stale collab peer ids superseded by principal reuse for the same username. */
  private readonly supersededCollabPeerIds = new Set<string>();

  private readonly rosterWaiters = new Map<string, Array<(ok: boolean) => void>>();

  private disposed = false;

  private readonly trust = new DocsCollabRosterTrust();

  private readonly resolveTicketKey: (kid: string) => Promise<CryptoKey | null>;

  private roomDigestTask: Promise<string> | null = null;

  private lastRosterPeers: RtcPeerDescriptor[] = [];

  constructor(private readonly ports: DocsCollabPrincipalReusePorts) {
    this.room = ports.room;
    this.registry = ports.registry ?? getPrincipalLinkRegistry();
    this.ackTimeoutMs = ports.ackTimeoutMs ?? COLLAB_REUSE_ACK_TIMEOUT_MS;
    this.principalConnectDeferMs =
      ports.principalConnectDeferMs ?? COLLAB_REUSE_PRINCIPAL_CONNECT_DEFER_MS;
    this.scheduleTimeout = ports.setTimeoutFn ?? setTimeout.bind(globalThis);
    this.cancelTimeout = ports.clearTimeoutFn ?? clearTimeout.bind(globalThis);
    this.resolveTicketKey = ports.resolveTicketKey ?? (async () => null);
    this.unsubscribe = this.registry.subscribe((username, principalPeerId, envelope) => {
      if (envelope.room !== this.room) return;
      return this.onEnvelope(username, principalPeerId, envelope);
    });
    this.unsubscribeLinks = this.registry.subscribeLinks(() => {
      this.dropDeadPrincipalLinks();
    });
    this.unsubscribeLinkOpen = this.registry.subscribeLinkOpen((username) => {
      this.onPrincipalLinkOpen(username);
    });
    this.unsubscribeSendFailed = this.registry.subscribeSendFailed((principalPeerId) => {
      for (const entry of this.reused.values()) {
        if (entry.principalPeerId === principalPeerId)
          this.ports.onSendFailed?.(entry.collabPeerId);
      }
    });
  }

  /**
   * Start a reuse handshake for rostered peers that already have a principal
   * DC. Safe to call on every poll — pending/reused/failed peers are skipped.
   */
  considerRoster(peers: RtcPeerDescriptor[], myId: string | null): void {
    this.lastRosterPeers = peers;
    this.trust.remember(peers, myId);
    this.flushRosterWaiters();
    this.dropUnrosteredPeers();
    this.dropDeadPrincipalLinks();
    this.dropReuseForMultiPeerUsers();
    for (const peer of peers) {
      if (!myId || peer.id === myId) continue;
      this.remapReusedIdentity(peer);
      this.tryReuse(peer);
    }
  }

  /** True when collab must not create a new RTCPeerConnection for this peer. */
  shouldSkipIce(peer: RtcPeerDescriptor): boolean {
    const username = peer.user ?? "";
    if (username && this.isMultiPeerUser(username)) return false;
    if (this.reused.has(peer.id)) return true;
    if (!username) return false;
    if (this.pending.get(username)?.collabPeerId === peer.id) return true;
    if (this.deferredFreshIce.get(username)?.collabPeerId === peer.id) return true;
    return false;
  }

  /** Drop inbound collab signaling offers when reuse already covers this peer/user. */
  shouldIgnoreOffer(fromPeerId: string): boolean {
    const rosterPeer = this.lastRosterPeers.find((peer) => peer.id === fromPeerId);
    const username = rosterPeer?.user ?? "";
    if (username && this.isMultiPeerUser(username)) return false;
    if (this.supersededCollabPeerIds.has(fromPeerId)) return true;
    if (this.reused.has(fromPeerId)) return true;
    return false;
  }

  sendTo(collabPeerId: string, msg: unknown): boolean {
    const entry = this.reused.get(collabPeerId);
    if (!entry) return false;
    return this.registry.sendToPrincipalPeer(entry.principalPeerId, this.dataEnvelope(msg));
  }

  broadcast(msg: unknown): void {
    const envelope = this.dataEnvelope(msg);
    for (const entry of this.reused.values()) {
      this.registry.sendToPrincipalPeer(entry.principalPeerId, envelope);
    }
  }

  overlayStatuses(meshStatuses: DocsCollabMeshPeerStatus[]): DocsCollabMeshPeerStatus[] {
    const byId = new Map(meshStatuses.map((peer) => [peer.id, { ...peer }]));
    for (const entry of this.reused.values()) {
      byId.set(entry.collabPeerId, {
        id: entry.collabPeerId,
        name: entry.name,
        link: "connected",
      });
    }
    return [...byId.values()];
  }

  extraPeers(): DocsCollabMeshPeer[] {
    return [...this.reused.values()].map((entry) => ({
      id: entry.collabPeerId,
      name: entry.name,
    }));
  }

  reusedLinkCount(): number {
    return this.reused.size;
  }

  dropPeer(collabPeerId: string, sendClose: boolean): void {
    const entry = this.reused.get(collabPeerId);
    if (!entry) return;
    this.reused.delete(collabPeerId);
    if (sendClose) {
      this.registry.sendToPrincipalPeer(entry.principalPeerId, this.closeEnvelope());
    }
    this.ports.onReuseFallback?.(collabPeerId);
    this.ports.onLinkChange();
  }

  dispose(): void {
    this.disposed = true;
    for (const list of this.rosterWaiters.values()) for (const finish of list) finish(false);
    this.rosterWaiters.clear();
    for (const pending of this.pending.values()) this.cancelTimeout(pending.timer);
    this.pending.clear();
    for (const deferred of this.deferredFreshIce.values()) this.cancelTimeout(deferred.timer);
    this.deferredFreshIce.clear();
    for (const entry of [...this.reused.values()]) {
      this.registry.sendToPrincipalPeer(entry.principalPeerId, this.closeEnvelope());
    }
    this.reused.clear();
    this.unsubscribe();
    this.unsubscribeLinks();
    this.unsubscribeLinkOpen();
    this.unsubscribeSendFailed();
  }

  /** Retry reuse for roster peers when a principal DC opens (no poll-changed wait). */
  onPrincipalLinkOpen(username: string): void {
    const myId = this.ports.getMyCollabPeerId();
    if (!myId || !username) return;
    this.cancelDeferFreshIce(username);
    for (const peer of this.lastRosterPeers) {
      if (peer.id === myId || peer.user !== username) continue;
      this.tryReuse(peer);
    }
  }

  /**
   * A reuse envelope is only trustworthy when the collab roster lists the
   * sender under the collab peer id the envelope claims, or when a present
   * C2 ticket verifies for that same username and peer id. Both halves of the
   * roster check matter: the username proves document access, the peer id
   * keeps a rostered account from speaking for somebody else's peer row.
   * A present ticket still has to name a rostered peer, and its access cannot
   * exceed the roster row. A missing ticket uses the roster check alone.
   */
  private mayReuseWith(fromUsername: string, collabPeerId: string | undefined): boolean;
  private mayReuseWith(
    fromUsername: string,
    collabPeerId: string | undefined,
    ticket: string,
  ): Promise<DocsCollabAccess | null>;
  private mayReuseWith(
    fromUsername: string,
    collabPeerId: string | undefined,
    ticket?: string,
  ): boolean | Promise<DocsCollabAccess | null> {
    if (ticket) return this.verifiedTicketAccess(fromUsername, collabPeerId, ticket);
    if (!this.trust.isRosteredUser(fromUsername)) {
      this.logMiss(collabPeerId ?? fromUsername, "not-in-collab-roster", fromUsername);
      return false;
    }
    if (collabPeerId && this.trust.isRosteredPeerId(collabPeerId)) {
      if (this.trust.userForPeerId(collabPeerId) !== fromUsername) {
        this.logMiss(collabPeerId, "peer-id-not-owned-by-sender", fromUsername);
        return false;
      }
    }
    return true;
  }

  /**
   * Verify a presented ticket. `user` and `peer` have to match the principal
   * link and the envelope. The ticket binds identity; the roster is the
   * fresher right, so a rostered peer gets the tighter of the two. A peer
   * that is not on the roster is held for up to 1 s while the roster refreshes,
   * then dropped. A failure is a drop, not a fall back to an unchecked ticket.
   */
  private async verifiedTicketAccess(
    fromUsername: string,
    collabPeerId: string | undefined,
    ticket: string,
  ): Promise<DocsCollabAccess | null> {
    if (!collabPeerId) {
      this.logMiss(fromUsername, "ticket-missing-peer", fromUsername);
      return null;
    }
    const payload = await verifyCollabTicket({
      ticket,
      claims: {
        room: await this.roomDigest(),
        user: fromUsername,
        peer: collabPeerId,
      },
      resolveKey: this.resolveTicketKey,
      nowSeconds: this.ports.nowSeconds?.(),
    });
    if (!payload || payload.user !== fromUsername || payload.peer !== collabPeerId) {
      this.logMiss(collabPeerId, "ticket-rejected", fromUsername);
      return null;
    }
    if (!(await this.waitForRosteredPeer(collabPeerId))) {
      this.logMiss(collabPeerId, "ticket-peer-not-rostered", fromUsername);
      return null;
    }
    return tighterDocsCollabAccess(payload.access, this.trust.accessForPeerId(collabPeerId));
  }

  private roomDigest(): Promise<string> {
    this.roomDigestTask ??= collabRoomKey(this.room);
    return this.roomDigestTask;
  }

  private handshakeEnvelope(op: "open" | "ack", collabPeerId: string): CollabReuseEnvelope {
    const envelope: CollabReuseEnvelope = {
      v: 1,
      kind: "collab-reuse",
      room: this.room,
      op,
      collabPeerId,
      name: this.ports.getMyName(),
    };
    const ticket = this.ports.getOwnTicket?.();
    if (ticket) envelope.ticket = ticket;
    return envelope;
  }

  /** A share revoked mid-session drops off the roster; so does its reuse link. */
  private dropUnrosteredPeers(): void {
    for (const entry of [...this.reused.values()]) {
      if (this.trust.isRosteredUser(entry.username)) continue;
      this.log("reuse-miss", {
        remoteId: entry.collabPeerId,
        username: entry.username,
        reason: "left-collab-roster",
      });
      this.dropPeer(entry.collabPeerId, true);
    }
  }

  private dropDeadPrincipalLinks(): void {
    for (const entry of [...this.reused.values()]) {
      if (this.registry.getLink(entry.principalPeerId)) continue;
      this.reused.delete(entry.collabPeerId);
      this.rememberReuseFailure(entry.username);
      this.log("reuse-miss", {
        remoteId: entry.collabPeerId,
        username: entry.username,
        reason: "principal-link-gone",
      });
      this.ports.onReuseFallback?.(entry.collabPeerId);
      this.ports.onLinkChange();
    }
  }

  private remapReusedIdentity(peer: RtcPeerDescriptor): void {
    const username = peer.user ?? "";
    if (!username) return;
    const existing = [...this.reused.values()].find((entry) => entry.username === username);
    if (!existing || existing.collabPeerId === peer.id) return;
    // A second device of the same user is still on the roster. Only a vanished
    // id (same-browser reload) is remapped onto the new peer.
    if (this.lastRosterPeers.some((rostered) => rostered.id === existing.collabPeerId)) return;
    this.supersededCollabPeerIds.add(existing.collabPeerId);
    this.reused.delete(existing.collabPeerId);
    this.reused.set(peer.id, { ...existing, collabPeerId: peer.id, name: peer.name });
  }

  private tryReuse(peer: RtcPeerDescriptor): void {
    const username = peer.user ?? "";
    if (!username) {
      this.logMiss(peer.id, "no-user", peer.id);
      return;
    }
    if (this.isMultiPeerUser(username)) {
      this.cancelPendingReuse(username);
      this.logMiss(peer.id, "multi-peer-user", username);
      return;
    }
    if (this.reusedEntryFor(username)) return;
    if (this.pending.has(username) || this.failedUsernames.has(username)) return;
    if (!this.registry.hasOpenLink(username)) {
      if (this.registry.isConnectingTo(username)) {
        this.scheduleDeferFreshIce(peer);
        return;
      }
      this.logMiss(peer.id, "no-principal-pc", username);
      return;
    }
    const myId = this.ports.getMyCollabPeerId();
    if (!myId) return;
    const principalPeerIds = this.registry
      .linksForUsername(username)
      .map((link) => link.principalPeerId);
    this.log("reuse-hit", { remoteId: peer.id, username });
    const timer = this.scheduleTimeout(() => {
      const pending = this.pending.get(username);
      this.pending.delete(username);
      this.rememberReuseFailure(username);
      this.log("reuse-miss", { remoteId: peer.id, username, reason: "ack-timeout" });
      for (const principalPeerId of pending?.principalPeerIds ?? principalPeerIds) {
        this.registry.sendToPrincipalPeer(principalPeerId, this.closeEnvelope());
      }
      this.ports.onReuseFallback?.(peer.id);
      this.ports.onLinkChange();
    }, this.ackTimeoutMs);
    this.pending.set(username, {
      collabPeerId: peer.id,
      name: peer.name,
      username,
      principalPeerIds,
      timer,
    });
    this.registry.sendToUsername(username, this.handshakeEnvelope("open", myId));
  }

  private onEnvelope(
    fromUsername: string,
    fromPrincipalPeerId: string,
    envelope: CollabReuseEnvelope,
  ): void | Promise<void> {
    if (envelope.op === "close") {
      const collabPeerId = envelope.collabPeerId;
      if (collabPeerId) this.dropPeer(collabPeerId, false);
      else {
        for (const entry of [...this.reused.values()]) {
          if (entry.username === fromUsername) this.dropPeer(entry.collabPeerId, false);
        }
      }
      return;
    }
    if (
      envelope.ticket &&
      (envelope.op === "open" || envelope.op === "ack" || envelope.op === "data")
    ) {
      return this.onEnvelopeWithTicket(fromUsername, fromPrincipalPeerId, envelope);
    }
    if (envelope.op === "open") {
      if (!this.mayReuseWith(fromUsername, envelope.collabPeerId)) return;
      if (!this.acceptRemote(fromUsername, fromPrincipalPeerId, envelope, "open")) return;
      const myId = this.ports.getMyCollabPeerId();
      if (!myId) return;
      this.registry.sendToPrincipalPeer(fromPrincipalPeerId, this.handshakeEnvelope("ack", myId));
      return;
    }
    if (envelope.op === "ack") {
      if (!this.mayReuseWith(fromUsername, envelope.collabPeerId)) return;
      this.acceptRemote(fromUsername, fromPrincipalPeerId, envelope, "ack");
      return;
    }
    if (envelope.op === "data") {
      this.forwardRosterData(fromUsername, envelope);
    }
  }

  private async onEnvelopeWithTicket(
    fromUsername: string,
    fromPrincipalPeerId: string,
    envelope: CollabReuseEnvelope,
  ): Promise<void> {
    const ticket = envelope.ticket;
    if (!ticket) return;
    if (envelope.op === "data") {
      const forwarded = this.dataForwardTarget(fromUsername, envelope);
      if (!forwarded) return;
      const access = await this.mayReuseWith(fromUsername, forwarded.from, ticket);
      if (!access) return;
      this.emitData(forwarded.from, forwarded.payload, fromUsername, access);
      return;
    }
    const access = await this.mayReuseWith(fromUsername, envelope.collabPeerId, ticket);
    if (!access) return;
    if (envelope.op === "open") {
      if (!this.acceptRemote(fromUsername, fromPrincipalPeerId, envelope, "open")) return;
      const myId = this.ports.getMyCollabPeerId();
      if (!myId) return;
      this.registry.sendToPrincipalPeer(fromPrincipalPeerId, this.handshakeEnvelope("ack", myId));
      return;
    }
    if (envelope.op === "ack") {
      this.acceptRemote(fromUsername, fromPrincipalPeerId, envelope, "ack");
    }
  }

  private forwardRosterData(fromUsername: string, envelope: CollabReuseEnvelope): void {
    const forwarded = this.dataForwardTarget(fromUsername, envelope);
    if (!forwarded) return;
    if (!this.mayReuseWith(fromUsername, forwarded.from)) return;
    this.emitData(
      forwarded.from,
      forwarded.payload,
      fromUsername,
      this.trust.accessForUser(fromUsername),
    );
  }

  /** Identity checks shared by roster and ticket data. Null means drop. */
  private dataForwardTarget(
    fromUsername: string,
    envelope: CollabReuseEnvelope,
  ): { from: string; payload: unknown } | null {
    const myId = this.ports.getMyCollabPeerId();
    if (envelope.collabPeerId && myId && envelope.collabPeerId === myId) return null;
    const attached = [...this.reused.values()].find((entry) => entry.username === fromUsername);
    if (!attached) return null;
    const from = envelope.collabPeerId ?? attached.collabPeerId;
    if (from !== attached.collabPeerId) return null;
    if (envelope.payload === undefined) return null;
    const payload = envelope.payload;
    if (!payload || typeof payload !== "object") return null;
    return { from, payload };
  }

  private emitData(
    from: string,
    payload: unknown,
    fromUsername: string,
    access: DocsCollabAccess,
  ): void {
    this.ports.onMessage({
      ...(payload as DocsCollabMeshMessage),
      from,
      trust: { user: fromUsername, access },
    } as DocsCollabMeshMessage);
  }

  private acceptRemote(
    fromUsername: string,
    fromPrincipalPeerId: string,
    envelope: CollabReuseEnvelope,
    via: "open" | "ack",
  ): boolean {
    const collabPeerId = envelope.collabPeerId;
    if (!collabPeerId) return false;
    if (this.disposed) return false;
    // One principal link cannot stand in for two collab peers. Attaching would
    // abort the ICE dial that should carry this username.
    if (this.isMultiPeerUser(fromUsername)) {
      this.logMiss(collabPeerId, "multi-peer-user", fromUsername);
      return false;
    }
    const pending = this.pending.get(fromUsername);
    if (pending) {
      this.cancelTimeout(pending.timer);
      this.pending.delete(fromUsername);
    }
    this.failedUsernames.delete(fromUsername);
    const name = envelope.name ?? pending?.name ?? fromUsername;
    const wasNew = !this.reused.has(collabPeerId);
    this.reused.set(collabPeerId, {
      collabPeerId,
      name,
      username: fromUsername,
      principalPeerId: fromPrincipalPeerId,
    });
    this.log("dc-open", { remoteId: collabPeerId, username: fromUsername, reused: true, via });
    this.ports.onReuseAttached?.(collabPeerId);
    if (wasNew) this.ports.onDcOpen(collabPeerId);
    this.ports.onLinkChange();
    return true;
  }

  private dataEnvelope(payload: unknown): CollabReuseEnvelope {
    return {
      v: 1,
      kind: "collab-reuse",
      room: this.room,
      op: "data",
      collabPeerId: this.ports.getMyCollabPeerId() ?? undefined,
      payload,
    };
  }

  private scheduleDeferFreshIce(peer: RtcPeerDescriptor): void {
    const username = peer.user ?? "";
    if (!username) return;
    const existing = this.deferredFreshIce.get(username);
    if (existing) {
      existing.collabPeerId = peer.id;
      return;
    }
    this.log("reuse-defer", { remoteId: peer.id, username, reason: "principal-connecting" });
    const tick = (): void => {
      const deferred = this.deferredFreshIce.get(username);
      if (!deferred) return;
      if (this.registry.isConnectingTo(username)) {
        deferred.timer = this.scheduleTimeout(tick, this.principalConnectDeferMs);
        return;
      }
      this.deferredFreshIce.delete(username);
      if (this.registry.hasOpenLink(username)) return;
      this.logMiss(deferred.collabPeerId, "no-principal-pc", username);
      this.ports.onReuseFallback?.(deferred.collabPeerId);
      this.ports.onLinkChange();
    };
    const timer = this.scheduleTimeout(tick, this.principalConnectDeferMs);
    this.deferredFreshIce.set(username, {
      collabPeerId: peer.id,
      username,
      timer,
    });
    this.ports.onLinkChange();
  }

  private cancelDeferFreshIce(username: string): void {
    const deferred = this.deferredFreshIce.get(username);
    if (!deferred) return;
    this.cancelTimeout(deferred.timer);
    this.deferredFreshIce.delete(username);
  }

  private waitForRosteredPeer(collabPeerId: string): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false);
    if (this.trust.isRosteredPeerId(collabPeerId)) return Promise.resolve(true);
    if (!this.rosterWaiters.has(collabPeerId) && this.rosterWaiters.size >= MAX_ROSTER_WAITERS) {
      return Promise.resolve(false);
    }
    this.ports.requestRosterRefresh?.();
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        this.cancelTimeout(timer);
        resolve(ok);
      };
      const timer = this.scheduleTimeout(() => {
        const list = this.rosterWaiters.get(collabPeerId);
        if (list) {
          const rest = list.filter((fn) => fn !== finish);
          if (rest.length > 0) this.rosterWaiters.set(collabPeerId, rest);
          else this.rosterWaiters.delete(collabPeerId);
        }
        finish(false);
      }, COLLAB_REUSE_ROSTER_WAIT_MS);
      const list = this.rosterWaiters.get(collabPeerId) ?? [];
      list.push(finish);
      this.rosterWaiters.set(collabPeerId, list);
    });
  }

  private flushRosterWaiters(): void {
    for (const [id, list] of [...this.rosterWaiters]) {
      if (!this.trust.isRosteredPeerId(id)) continue;
      this.rosterWaiters.delete(id);
      for (const finish of list) finish(true);
    }
  }

  /** A username with two collab peers cannot share one principal link. */
  private isMultiPeerUser(username: string): boolean {
    if (!username) return false;
    let count = 0;
    for (const peer of this.lastRosterPeers) {
      if (peer.user !== username) continue;
      count += 1;
      if (count > 1) return true;
    }
    return false;
  }

  private reusedEntryFor(username: string): ReusedPeer | undefined {
    if (!username) return undefined;
    for (const entry of this.reused.values()) {
      if (entry.username === username) return entry;
    }
    return undefined;
  }

  /**
   * A failed handshake must not displace a live reuse of the same username.
   * The healthy link stays; only the peer that failed falls back to ICE.
   */
  private rememberReuseFailure(username: string): void {
    if (!username || this.reusedEntryFor(username)) return;
    this.failedUsernames.add(username);
  }

  /** Second collab peer for a reused user: both sides leave reuse and use ICE. */
  private dropReuseForMultiPeerUsers(): void {
    const multi = new Set<string>();
    const seen = new Set<string>();
    for (const peer of this.lastRosterPeers) {
      const username = peer.user ?? "";
      if (!username) continue;
      if (seen.has(username)) multi.add(username);
      seen.add(username);
    }
    if (multi.size === 0) return;
    for (const entry of [...this.reused.values()]) {
      if (multi.has(entry.username)) this.dropPeer(entry.collabPeerId, true);
    }
  }

  /** Close a half-attached open without marking the username failed. */
  private cancelPendingReuse(username: string): void {
    const pending = this.pending.get(username);
    if (!pending) return;
    this.cancelTimeout(pending.timer);
    this.pending.delete(username);
    for (const principalPeerId of pending.principalPeerIds) {
      this.registry.sendToPrincipalPeer(principalPeerId, this.closeEnvelope());
    }
  }

  private closeEnvelope(): CollabReuseEnvelope {
    return {
      v: 1,
      kind: "collab-reuse",
      room: this.room,
      op: "close",
      collabPeerId: this.ports.getMyCollabPeerId() ?? undefined,
    };
  }

  private logMiss(remoteId: string, reason: string, username: string): void {
    const key = `${remoteId}:${reason}`;
    if (this.loggedMiss.has(key)) return;
    this.loggedMiss.add(key);
    this.log("reuse-miss", { remoteId, username, reason });
  }

  private log(event: string, details?: unknown): void {
    rtcLog({ channel: "collab", peerId: this.ports.getMyCollabPeerId() }, event, details);
  }
}
