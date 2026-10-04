import * as Y from "yjs";
import type { DocsCollabAccess } from "./docs-collab-access";
import {
  httpFallbackPeers,
  httpFallbackUsesStar,
  relayDuePeers,
  type HttpFallbackPeer,
} from "./docs-collab-http-fallback";
import {
  decodeYjsHttpPayload,
  diffForStateVector,
  encodeYjsHttpPayload,
  splitYjsUpdate,
  YJS_HTTP_BATCH_MS,
  YJS_HTTP_RESYNC_MS,
  type YjsHttpPayload,
} from "./docs-collab-http-wire";
import { applyGuardedRemoteUpdate } from "./docs-collab-update-guard";
import { MESH_ORIGIN } from "./docs-collab-utils";
import type { RelayRequestOutcome } from "@/lib/rtc/session/relay-request";

export type DocsHttpRosterPeer = {
  id: string;
  name: string;
  caps?: readonly string[];
  connected: boolean;
};

export type DocsHttpMailboxMessage = {
  from: string;
  type: string;
  payload: unknown;
};

export type DocsCollabHttpSyncPorts = {
  now: () => number;
  peers: () => readonly DocsHttpRosterPeer[];
  /** WebRTC will not open: forced relay with no TURN, or a blocked probe. */
  webrtcUnavailable: () => boolean;
  send: (to: string, type: "yjs" | "yjs-sv", payload: YjsHttpPayload) => void;
  sendStateVectorOnChannel: (peerId: string) => void;
  requestRelay: (peerId: string) => Promise<RelayRequestOutcome>;
  onRelay: (peerId: string, name: string, outcome: RelayRequestOutcome) => void;
  setFastPoll: (active: boolean) => void;
  getYDoc: () => Y.Doc | null;
  trust: (peerId: string) => { access: DocsCollabAccess; user: string };
};

/**
 * Per-peer HTTP fallback for Docs. Local updates are batched, remote updates
 * are applied and never re-sent, and a state-vector exchange repairs loss.
 */
export class DocsCollabHttpSync {
  private readonly seenAt = new Map<string, number>();

  private readonly relayRequested = new Set<string>();

  private readonly lastResync = new Map<string, number>();

  private readonly httpSince = new Set<string>();

  private pending: Uint8Array[] = [];

  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  private resyncTimer: ReturnType<typeof setInterval> | null = null;

  private seq = 0;

  private fastPoll = false;

  constructor(private readonly ports: DocsCollabHttpSyncPorts) {}

  start(): void {
    if (this.resyncTimer) return;
    this.resyncTimer = setInterval(() => this.resyncDue(), YJS_HTTP_RESYNC_MS);
    this.evaluate();
  }

  stop(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (this.resyncTimer) clearInterval(this.resyncTimer);
    this.flushTimer = null;
    this.resyncTimer = null;
    this.pending = [];
    if (this.fastPoll) {
      this.fastPoll = false;
      this.ports.setFastPoll(false);
    }
  }

  evaluate(): void {
    const now = this.ports.now();
    const peers = this.snapshot(now);
    const immediate = this.ports.webrtcUnavailable();
    const httpPeers = httpFallbackPeers(peers, now, immediate);
    const httpIds = new Set(httpPeers.map((peer) => peer.id));
    for (const peer of httpPeers) {
      if (this.httpSince.has(peer.id)) continue;
      this.httpSince.add(peer.id);
      this.sendStateVector(peer.id);
      this.lastResync.set(peer.id, now);
    }
    for (const id of [...this.httpSince]) {
      if (!httpIds.has(id)) this.httpSince.delete(id);
    }
    const wantFast = httpPeers.length > 0;
    if (wantFast !== this.fastPoll) {
      this.fastPoll = wantFast;
      this.ports.setFastPoll(wantFast);
    }
    for (const peer of relayDuePeers(peers, now, immediate, this.relayRequested)) {
      this.relayRequested.add(peer.id);
      void this.ports.requestRelay(peer.id).then((outcome) => {
        this.ports.onRelay(peer.id, peer.name, outcome);
      });
    }
  }

  noteLocalUpdate(update: Uint8Array): void {
    this.pending.push(update);
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, YJS_HTTP_BATCH_MS);
  }

  ingest(messages: readonly DocsHttpMailboxMessage[]): void {
    const doc = this.ports.getYDoc();
    if (!doc) return;
    for (const message of messages) {
      if (message.type !== "yjs" && message.type !== "yjs-sv") continue;
      const decoded = decodeYjsHttpPayload(message.payload);
      if (!decoded || !message.from) continue;
      if (message.type === "yjs-sv") {
        this.answerStateVector(message.from, decoded.bytes);
        continue;
      }
      const trust = this.ports.trust(message.from);
      applyGuardedRemoteUpdate({
        doc,
        update: decoded.bytes,
        access: trust.access,
        senderUser: trust.user,
        origin: MESH_ORIGIN,
        from: message.from,
      });
    }
  }

  private flush(): void {
    const updates = this.pending.splice(0);
    if (updates.length === 0) return;
    const now = this.ports.now();
    const peers = this.snapshot(now);
    const httpPeers = httpFallbackPeers(peers, now, this.ports.webrtcUnavailable());
    if (httpPeers.length === 0) return;
    const merged = updates.length === 1 ? updates[0]! : Y.mergeUpdates(updates);
    const star = httpFallbackUsesStar(peers, httpPeers);
    for (const piece of splitYjsUpdate(merged)) {
      const payload = encodeYjsHttpPayload(piece, this.nextSeq());
      if (star) {
        this.ports.send("*", "yjs", payload);
        continue;
      }
      for (const peer of httpPeers) this.ports.send(peer.id, "yjs", payload);
    }
  }

  private resyncDue(): void {
    const now = this.ports.now();
    const peers = this.snapshot(now);
    const immediate = this.ports.webrtcUnavailable();
    const httpIds = new Set(httpFallbackPeers(peers, now, immediate).map((peer) => peer.id));
    for (const peer of peers) {
      const onHttp = httpIds.has(peer.id);
      if (!onHttp && !peer.connected) continue;
      const last = this.lastResync.get(peer.id) ?? 0;
      if (now - last < YJS_HTTP_RESYNC_MS) continue;
      if (onHttp) this.sendStateVector(peer.id);
      else this.ports.sendStateVectorOnChannel(peer.id);
      this.lastResync.set(peer.id, now);
    }
  }

  private answerStateVector(peerId: string, stateVector: Uint8Array): void {
    const doc = this.ports.getYDoc();
    if (!doc) return;
    const diff = diffForStateVector(doc, stateVector);
    if (diff.byteLength <= 2) return;
    for (const piece of splitYjsUpdate(diff)) {
      this.ports.send(peerId, "yjs", encodeYjsHttpPayload(piece, this.nextSeq()));
    }
  }

  private sendStateVector(peerId: string): void {
    const doc = this.ports.getYDoc();
    if (!doc) return;
    this.ports.send(
      peerId,
      "yjs-sv",
      encodeYjsHttpPayload(Y.encodeStateVector(doc), this.nextSeq()),
    );
  }

  private snapshot(now: number): HttpFallbackPeer[] {
    return this.ports.peers().map((peer) => {
      const seenAt = this.seenAt.get(peer.id) ?? now;
      this.seenAt.set(peer.id, seenAt);
      return { ...peer, seenAt };
    });
  }

  private nextSeq(): number {
    this.seq += 1;
    return this.seq;
  }
}
