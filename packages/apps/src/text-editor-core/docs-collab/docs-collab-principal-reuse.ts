import { rtcLog } from "@/lib/rtc/log";
import type { CollabReuseEnvelope } from "@/lib/rtc/session/collab-reuse-envelope";
import {
  getPrincipalLinkRegistry,
  type PrincipalLinkRegistry,
} from "@/lib/rtc/session/principal-link-registry";
import type { RtcPeerDescriptor } from "@/lib/rtc/types";
import type {
  DocsCollabMeshMessage,
  DocsCollabMeshPeer,
  DocsCollabMeshPeerStatus,
} from "@/text-editor-core/docs-collab/docs-collab-types";

/** Wait this long for an `ack` before falling back to a fresh collab ICE handshake. */
export const COLLAB_REUSE_ACK_TIMEOUT_MS = 300;

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
  /** Principal reuse ended — dial fresh ICE (not called on successful reuse attach). */
  onReuseFallback?: () => void;
  /** Tear down an in-flight collab ICE handshake once reuse wins for this peer. */
  onReuseAttached?: (collabPeerId: string) => void;
  onMessage: (msg: DocsCollabMeshMessage) => void;
  ackTimeoutMs?: number;
  principalConnectDeferMs?: number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
};

/**
 * Attaches a collab room onto live principal data channels (`collab-reuse`
 * envelopes). Call `considerRoster` from the collab poll callback *before*
 * `shouldConnectToPeer` so reuse-hit peers skip ICE.
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

  private readonly pending = new Map<string, PendingPeer>();

  private readonly deferredFreshIce = new Map<string, DeferredFreshIce>();

  private readonly reused = new Map<string, ReusedPeer>();

  private readonly failedUsernames = new Set<string>();

  private readonly loggedMiss = new Set<string>();

  /** Stale collab peer ids superseded by principal reuse for the same username. */
  private readonly supersededCollabPeerIds = new Set<string>();

  private lastRosterPeers: RtcPeerDescriptor[] = [];

  constructor(private readonly ports: DocsCollabPrincipalReusePorts) {
    this.room = ports.room;
    this.registry = ports.registry ?? getPrincipalLinkRegistry();
    this.ackTimeoutMs = ports.ackTimeoutMs ?? COLLAB_REUSE_ACK_TIMEOUT_MS;
    this.principalConnectDeferMs =
      ports.principalConnectDeferMs ?? COLLAB_REUSE_PRINCIPAL_CONNECT_DEFER_MS;
    this.scheduleTimeout = ports.setTimeoutFn ?? setTimeout.bind(globalThis);
    this.cancelTimeout = ports.clearTimeoutFn ?? clearTimeout.bind(globalThis);
    this.unsubscribe = this.registry.subscribe((username, principalPeerId, envelope) => {
      if (envelope.room !== this.room) return;
      this.onEnvelope(username, principalPeerId, envelope);
    });
    this.unsubscribeLinks = this.registry.subscribeLinks(() => {
      this.dropDeadPrincipalLinks();
    });
    this.unsubscribeLinkOpen = this.registry.subscribeLinkOpen((username) => {
      this.onPrincipalLinkOpen(username);
    });
  }

  /**
   * Start a reuse handshake for rostered peers that already have a principal
   * DC. Safe to call on every poll — pending/reused/failed peers are skipped.
   */
  considerRoster(peers: RtcPeerDescriptor[], myId: string | null): void {
    this.lastRosterPeers = peers;
    this.dropDeadPrincipalLinks();
    for (const peer of peers) {
      if (!myId || peer.id === myId) continue;
      this.remapReusedIdentity(peer);
      if (this.reused.has(peer.id) || this.pending.has(peer.user ?? "")) continue;
      if (this.failedUsernames.has(peer.user ?? "")) continue;
      this.tryReuse(peer);
    }
  }

  /** True when collab must not create a new RTCPeerConnection for this peer. */
  shouldSkipIce(peer: RtcPeerDescriptor): boolean {
    const username = peer.user ?? "";
    if (this.reused.has(peer.id)) return true;
    if (username && this.pending.has(username)) return true;
    if (username && this.deferredFreshIce.has(username)) return true;
    if (username && [...this.reused.values()].some((entry) => entry.username === username)) {
      return true;
    }
    return false;
  }

  /** Drop inbound collab signaling offers when reuse already covers this peer/user. */
  shouldIgnoreOffer(fromPeerId: string): boolean {
    if (this.supersededCollabPeerIds.has(fromPeerId)) return true;
    if (this.reused.has(fromPeerId)) return true;
    const rosterPeer = this.lastRosterPeers.find((peer) => peer.id === fromPeerId);
    if (rosterPeer && this.shouldSkipIce(rosterPeer)) return true;
    const username = rosterPeer?.user ?? "";
    if (username && [...this.reused.values()].some((entry) => entry.username === username)) {
      return true;
    }
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
      this.registry.sendToPrincipalPeer(entry.principalPeerId, {
        v: 1,
        kind: "collab-reuse",
        room: this.room,
        op: "close",
        collabPeerId: this.ports.getMyCollabPeerId() ?? undefined,
      } satisfies CollabReuseEnvelope);
    }
    this.ports.onReuseFallback?.();
    this.ports.onLinkChange();
  }

  dispose(): void {
    for (const pending of this.pending.values()) this.cancelTimeout(pending.timer);
    this.pending.clear();
    for (const deferred of this.deferredFreshIce.values()) this.cancelTimeout(deferred.timer);
    this.deferredFreshIce.clear();
    for (const entry of [...this.reused.values()]) {
      this.registry.sendToPrincipalPeer(entry.principalPeerId, {
        v: 1,
        kind: "collab-reuse",
        room: this.room,
        op: "close",
        collabPeerId: this.ports.getMyCollabPeerId() ?? undefined,
      } satisfies CollabReuseEnvelope);
    }
    this.reused.clear();
    this.unsubscribe();
    this.unsubscribeLinks();
    this.unsubscribeLinkOpen();
  }

  /** Retry reuse for roster peers when a principal DC opens (no poll-changed wait). */
  onPrincipalLinkOpen(username: string): void {
    const myId = this.ports.getMyCollabPeerId();
    if (!myId || !username) return;
    this.cancelDeferFreshIce(username);
    for (const peer of this.lastRosterPeers) {
      if (peer.id === myId || peer.user !== username) continue;
      if (this.reused.has(peer.id) || this.pending.has(username)) continue;
      if (this.failedUsernames.has(username)) continue;
      this.tryReuse(peer);
    }
  }

  private dropDeadPrincipalLinks(): void {
    for (const entry of [...this.reused.values()]) {
      if (this.registry.getLink(entry.principalPeerId)) continue;
      this.reused.delete(entry.collabPeerId);
      this.failedUsernames.add(entry.username);
      this.log("reuse-miss", {
        remoteId: entry.collabPeerId,
        username: entry.username,
        reason: "principal-link-gone",
      });
      this.ports.onReuseFallback?.();
      this.ports.onLinkChange();
    }
  }

  private remapReusedIdentity(peer: RtcPeerDescriptor): void {
    const username = peer.user ?? "";
    if (!username) return;
    const existing = [...this.reused.values()].find((entry) => entry.username === username);
    if (!existing || existing.collabPeerId === peer.id) return;
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
    this.log("reuse-hit", { remoteId: peer.id, username });
    this.ports.onReuseAttached?.(peer.id);
    const timer = this.scheduleTimeout(() => {
      this.pending.delete(username);
      this.failedUsernames.add(username);
      this.log("reuse-miss", { remoteId: peer.id, username, reason: "ack-timeout" });
      this.ports.onReuseFallback?.();
      this.ports.onLinkChange();
    }, this.ackTimeoutMs);
    this.pending.set(username, {
      collabPeerId: peer.id,
      name: peer.name,
      username,
      timer,
    });
    this.registry.sendToUsername(username, {
      v: 1,
      kind: "collab-reuse",
      room: this.room,
      op: "open",
      collabPeerId: myId,
      name: this.ports.getMyName(),
    } satisfies CollabReuseEnvelope);
  }

  private onEnvelope(
    fromUsername: string,
    fromPrincipalPeerId: string,
    envelope: CollabReuseEnvelope,
  ): void {
    if (envelope.op === "open") {
      this.acceptRemote(fromUsername, fromPrincipalPeerId, envelope, "open");
      const myId = this.ports.getMyCollabPeerId();
      if (!myId) return;
      this.registry.sendToPrincipalPeer(fromPrincipalPeerId, {
        v: 1,
        kind: "collab-reuse",
        room: this.room,
        op: "ack",
        collabPeerId: myId,
        name: this.ports.getMyName(),
      } satisfies CollabReuseEnvelope);
      return;
    }
    if (envelope.op === "ack") {
      this.acceptRemote(fromUsername, fromPrincipalPeerId, envelope, "ack");
      return;
    }
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
    if (envelope.op === "data") {
      const myId = this.ports.getMyCollabPeerId();
      if (envelope.collabPeerId && myId && envelope.collabPeerId === myId) {
        return;
      }
      const from =
        envelope.collabPeerId ??
        [...this.reused.values()].find((entry) => entry.username === fromUsername)?.collabPeerId;
      if (!from || envelope.payload === undefined) return;
      const payload = envelope.payload;
      if (!payload || typeof payload !== "object") return;
      this.ports.onMessage({ ...(payload as DocsCollabMeshMessage), from });
    }
  }

  private acceptRemote(
    fromUsername: string,
    fromPrincipalPeerId: string,
    envelope: CollabReuseEnvelope,
    via: "open" | "ack",
  ): void {
    const collabPeerId = envelope.collabPeerId;
    if (!collabPeerId) return;
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
    this.markSupersededCollabPeerIds(fromUsername, collabPeerId);
    this.log("dc-open", { remoteId: collabPeerId, username: fromUsername, reused: true, via });
    this.ports.onReuseAttached?.(collabPeerId);
    if (wasNew) this.ports.onDcOpen(collabPeerId);
    this.ports.onLinkChange();
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
      this.ports.onReuseFallback?.();
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

  private markSupersededCollabPeerIds(username: string, activeCollabPeerId: string): void {
    for (const peer of this.lastRosterPeers) {
      if (peer.user === username && peer.id !== activeCollabPeerId) {
        this.supersededCollabPeerIds.add(peer.id);
      }
    }
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
