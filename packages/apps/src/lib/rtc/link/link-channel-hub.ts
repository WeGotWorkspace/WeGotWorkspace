import { verifyCollabHello } from "@/lib/rtc/link/collab-hello-verify";
import {
  buildLinkLabel,
  LINK_ACCEPT_TIMEOUT_MS,
  LINK_HELLO_TIMEOUT_MS,
  LINK_HUB_TICK_MS,
  LINK_OPEN_TIMEOUT_MS,
  LINK_RETRY_AFTER_CLOSE_MS,
  LINK_RETRY_AFTER_REJECT_MS,
  LINK_ROSTER_WAIT_MS,
  outboundKey,
  parseLinkFrame,
  parseLinkLabel,
  planOutbound,
  retryDelayForReject,
  type HelloFrame,
  type OutboundRecord,
} from "@/lib/rtc/link/link-channel-protocol";
import type {
  ChannelLike,
  LinkHost,
  OwnerSink,
  PeerChannelState,
  RoomEndpointState,
} from "@/lib/rtc/link/link-channel-types";
import { FrameReassembler, ingestDataChannelData } from "@/lib/rtc/session/data-channel-frames";
import { DataChannelOutbound } from "@/lib/rtc/session/data-channel-outbound";
import {
  tighterDocsCollabAccess,
  type DocsCollabAccess,
} from "@/text-editor-core/docs-collab/docs-collab-access";
import { createCollabTicketKeyCache } from "@/text-editor-core/docs-collab/docs-collab-ticket";

export type LinkChannelHubPorts = {
  now: () => number;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
  log: (event: string, details: Record<string, unknown>) => void;
  nowSeconds?: () => number;
};

type RoomEntry = { state: RoomEndpointState; owner: string; updatedAt: number };

type OutboundLive = OutboundRecord & {
  channel: ChannelLike | null;
  sender: DataChannelOutbound | null;
};

type InboundLive = {
  roomKey: string;
  linkPeer: string;
  user: string;
  state: "await-hello" | "verifying" | "bound";
  peer: string | null;
  access: DocsCollabAccess;
  ticketAccess: DocsCollabAccess;
  since: number;
  hello: HelloFrame | null;
  sender: DataChannelOutbound;
  channel: ChannelLike;
  needRosterSent: boolean;
};

const ROOM_SILENCE_MS = 15_000;

export class LinkChannelHub {
  private host: LinkHost | null = null;

  private unsubIncoming: (() => void) | null = null;

  private unsubLinks: (() => void) | null = null;

  private tick: unknown = null;

  private localOwner: string | null = null;

  private readonly rooms = new Map<string, RoomEntry>();

  private readonly sinks = new Map<string, OwnerSink>();

  private readonly outbound = new Map<string, OutboundLive>();

  private readonly inbound = new Map<ChannelLike, InboundLive>();

  private readonly keyCaches = new Map<
    string,
    { kid: string; resolve: (kid: string) => Promise<CryptoKey | null> }
  >();

  private readonly reassembler = new FrameReassembler();

  private readonly published = new Map<string, string>();

  constructor(private readonly ports: LinkChannelHubPorts) {}

  setLocalOwner(owner: string): void {
    this.localOwner = owner;
  }

  hasHost(): boolean {
    return this.host !== null;
  }

  attachHost(host: LinkHost): void {
    if (this.host) this.detachHost(this.host);
    this.host = host;
    this.unsubIncoming = host.onIncomingChannel((linkPeer, channel) => {
      this.handleIncoming(linkPeer, channel);
    });
    this.unsubLinks = host.onLinksChanged(() => this.reconcile());
    this.tick = this.ports.setInterval(() => this.reconcile(), LINK_HUB_TICK_MS);
    this.reconcile();
    this.ports.log("chan-host-attached", {});
  }

  detachHost(host: LinkHost): void {
    if (this.host !== host) return;
    this.unsubIncoming?.();
    this.unsubLinks?.();
    this.unsubIncoming = null;
    this.unsubLinks = null;
    if (this.tick !== null) {
      this.ports.clearInterval(this.tick);
      this.tick = null;
    }
    for (const record of this.outbound.values()) this.closeChannel(record.channel);
    for (const record of this.inbound.values()) this.closeChannel(record.channel);
    this.outbound.clear();
    this.inbound.clear();
    this.host = null;
    for (const roomKey of this.rooms.keys()) this.publish(roomKey);
    this.ports.log("chan-host-detached", {});
  }

  setSink(owner: string, sink: OwnerSink): void {
    this.sinks.set(owner, sink);
  }

  removeSink(owner: string): void {
    this.sinks.delete(owner);
    for (const [roomKey, entry] of [...this.rooms]) {
      if (entry.owner === owner) this.removeRoom(owner, roomKey);
    }
  }

  setRoom(owner: string, state: RoomEndpointState): void {
    this.rooms.set(state.roomKey, { state, owner, updatedAt: this.ports.now() });
    this.refreshKeyCache(state);
    for (const [channel, record] of [...this.inbound]) {
      if (record.roomKey !== state.roomKey) continue;
      if (record.state === "bound" && record.peer) {
        const row = state.roster.find((candidate) => candidate.id === record.peer);
        if (!row || row.user !== record.user) {
          this.inbound.delete(channel);
          this.closeChannel(channel);
          continue;
        }
        record.access = tighterDocsCollabAccess(record.ticketAccess, row.access);
      } else if (record.state === "verifying") {
        void this.verify(record);
      }
    }
    for (const record of this.outbound.values()) {
      if (record.roomKey !== state.roomKey || record.state !== "ready" || !record.acceptedPeer) {
        continue;
      }
      if (this.acceptMatchesLink(record.roomKey, record.linkPeer, record.acceptedPeer)) continue;
      this.closeChannel(record.channel);
      record.state = "rejected";
      record.retryAt = this.ports.now() + LINK_RETRY_AFTER_REJECT_MS;
      record.acceptedPeer = null;
      record.channel = null;
      record.sender = null;
      this.ports.log("chan-accept-mismatch", {
        roomKey: record.roomKey,
        linkPeer: record.linkPeer,
      });
    }
    this.reconcile();
  }

  removeRoom(owner: string, roomKey: string): void {
    const entry = this.rooms.get(roomKey);
    if (!entry || entry.owner !== owner) return;
    this.rooms.delete(roomKey);
    this.published.delete(roomKey);
    this.keyCaches.delete(roomKey);
    for (const [key, record] of [...this.outbound]) {
      if (record.roomKey !== roomKey) continue;
      this.closeChannel(record.channel);
      this.outbound.delete(key);
    }
    for (const [channel, record] of [...this.inbound]) {
      if (record.roomKey !== roomKey) continue;
      this.closeChannel(channel);
      this.inbound.delete(channel);
    }
  }

  kick(roomKey: string): void {
    const now = this.ports.now();
    for (const record of this.outbound.values()) {
      if (record.roomKey !== roomKey) continue;
      if (record.state === "closed" || record.state === "rejected") record.retryAt = now;
    }
    this.reconcile();
  }

  send(roomKey: string, toPeer: string, msg: unknown): boolean {
    const host = this.host;
    if (!host) return false;
    for (const record of this.outbound.values()) {
      if (
        record.roomKey !== roomKey ||
        record.state !== "ready" ||
        record.acceptedPeer !== toPeer
      ) {
        continue;
      }
      if (!record.sender) return false;
      this.safeSend(record.sender, { t: "d", m: msg }, host.peerAdvertisesBin(record.linkPeer));
      return true;
    }
    return false;
  }

  broadcast(roomKey: string, msg: unknown): number {
    const host = this.host;
    if (!host) return 0;
    let count = 0;
    for (const record of this.outbound.values()) {
      if (record.roomKey !== roomKey || record.state !== "ready" || !record.sender) continue;
      this.safeSend(record.sender, { t: "d", m: msg }, host.peerAdvertisesBin(record.linkPeer));
      count += 1;
    }
    return count;
  }

  peerStates(roomKey: string): ReadonlyMap<string, PeerChannelState> {
    return new Map(this.statesFor(roomKey));
  }

  private reconcile(): void {
    const host = this.host;
    if (!host) return;
    const now = this.ports.now();
    const links = host.livePeers();
    const live = new Set(links.map((link) => link.linkPeer));

    for (const [key, record] of [...this.outbound]) {
      if (live.has(record.linkPeer)) continue;
      if (record.state === "closed" || record.state === "rejected") {
        if (record.channel) {
          this.closeChannel(record.channel);
          record.channel = null;
          record.sender = null;
        }
        continue;
      }
      this.closeChannel(record.channel);
      record.state = "closed";
      record.retryAt = now + LINK_RETRY_AFTER_CLOSE_MS;
      record.acceptedPeer = null;
      record.channel = null;
      record.sender = null;
      this.outbound.set(key, record);
    }
    for (const [channel, record] of [...this.inbound]) {
      if (live.has(record.linkPeer)) continue;
      this.closeChannel(channel);
      this.inbound.delete(channel);
    }

    for (const [key, record] of [...this.outbound]) {
      const timedOut =
        (record.state === "opening" && now - record.since > LINK_OPEN_TIMEOUT_MS) ||
        (record.state === "await-accept" && now - record.since > LINK_ACCEPT_TIMEOUT_MS);
      if (!timedOut) continue;
      this.closeChannel(record.channel);
      record.state = "closed";
      record.retryAt = now + LINK_RETRY_AFTER_CLOSE_MS;
      record.acceptedPeer = null;
      record.channel = null;
      record.sender = null;
      this.outbound.set(key, record);
      this.ports.log("chan-timeout", { roomKey: record.roomKey, linkPeer: record.linkPeer });
    }
    for (const [channel, record] of [...this.inbound]) {
      if (record.state === "await-hello" && now - record.since > LINK_HELLO_TIMEOUT_MS) {
        this.closeChannel(channel);
        this.inbound.delete(channel);
        continue;
      }
      if (record.state === "verifying" && now - record.since > LINK_ROSTER_WAIT_MS) {
        this.safeSend(record.sender, { t: "reject", reason: "not-rostered" }, false);
        this.closeChannel(channel);
        this.inbound.delete(channel);
      }
    }

    if (this.localOwner) {
      for (const [roomKey, entry] of [...this.rooms]) {
        if (entry.owner === this.localOwner) continue;
        if (entry.updatedAt < now - ROOM_SILENCE_MS) this.removeRoom(entry.owner, roomKey);
      }
    }

    const actions = planOutbound({
      rooms: [...this.rooms.values()].map((entry) => entry.state),
      links,
      outbound: this.outbound,
      now,
    });
    for (const action of actions) {
      if (action.op === "open") this.openOutbound(action.roomKey, action.linkPeer);
      else {
        const key = outboundKey(action.roomKey, action.linkPeer);
        const record = this.outbound.get(key);
        if (!record) continue;
        this.closeChannel(record.channel);
        record.state = "closed";
        record.retryAt = now;
        record.acceptedPeer = null;
        record.channel = null;
        record.sender = null;
      }
    }

    for (const roomKey of this.rooms.keys()) this.publish(roomKey);
  }

  private openOutbound(roomKey: string, linkPeer: string): void {
    const host = this.host;
    if (!host) return;
    const now = this.ports.now();
    const key = outboundKey(roomKey, linkPeer);
    const label = buildLinkLabel("collab", roomKey);
    const channel = host.createChannel(linkPeer, label);
    if (!channel) {
      this.outbound.set(key, {
        roomKey,
        linkPeer,
        state: "closed",
        acceptedPeer: null,
        since: now,
        retryAt: now + LINK_RETRY_AFTER_CLOSE_MS,
        channel: null,
        sender: null,
      });
      return;
    }
    channel.binaryType = "arraybuffer";
    const sender = new DataChannelOutbound(channel as unknown as RTCDataChannel, (error) => {
      this.ports.log("chan-send-failed", { roomKey, linkPeer, error: String(error) });
      this.closeChannel(channel);
    });
    const record: OutboundLive = {
      roomKey,
      linkPeer,
      state: "opening",
      acceptedPeer: null,
      since: now,
      retryAt: 0,
      channel,
      sender,
    };
    this.outbound.set(key, record);
    this.ports.log("chan-open", { roomKey, linkPeer });

    const reassemblyKey = `${linkPeer}|${label}|out`;
    channel.onopen = () => {
      const current = this.outbound.get(key);
      if (!current || current.channel !== channel) return;
      const room = this.rooms.get(roomKey)?.state;
      if (!room) return;
      const hello: HelloFrame =
        room.ticket === undefined
          ? { t: "hello", v: 1, peer: room.myPeerId }
          : { t: "hello", v: 1, peer: room.myPeerId, ticket: room.ticket };
      this.safeSend(sender, hello, host.peerAdvertisesBin(linkPeer));
      current.state = "await-accept";
      current.since = this.ports.now();
      this.ports.log("chan-hello", { roomKey, linkPeer });
    };
    channel.onmessage = (event) => {
      const current = this.outbound.get(key);
      if (!current || current.channel !== channel) return;
      const text = ingestDataChannelData(this.reassembler, reassemblyKey, event.data);
      if (text === null) return;
      const frame = parseLinkFrame(text);
      if (!frame) return;
      if (frame.t === "accept" && current.state === "await-accept") {
        if (!this.acceptMatchesLink(roomKey, linkPeer, frame.peer)) {
          current.state = "rejected";
          current.retryAt = this.ports.now() + LINK_RETRY_AFTER_REJECT_MS;
          current.acceptedPeer = null;
          this.ports.log("chan-accept-mismatch", { roomKey, linkPeer, peer: frame.peer });
          this.closeChannel(channel);
          this.publish(roomKey);
          return;
        }
        current.state = "ready";
        current.acceptedPeer = frame.peer;
        this.ports.log("chan-ready", { roomKey, linkPeer, peer: frame.peer });
        this.publish(roomKey);
        return;
      }
      if (frame.t === "reject") {
        current.state = "rejected";
        current.retryAt = this.ports.now() + retryDelayForReject(frame.reason);
        current.acceptedPeer = null;
        this.ports.log("chan-reject", { roomKey, linkPeer, reason: frame.reason });
        this.closeChannel(channel);
        this.publish(roomKey);
      }
    };
    channel.onclose = () => {
      this.reassembler.dropRemote(reassemblyKey);
      const current = this.outbound.get(key);
      if (!current || current.channel !== channel || current.state === "rejected") return;
      current.state = "closed";
      current.retryAt = this.ports.now() + LINK_RETRY_AFTER_CLOSE_MS;
      current.acceptedPeer = null;
      current.channel = null;
      current.sender = null;
      this.ports.log("chan-close", { roomKey, linkPeer });
      this.publish(roomKey);
    };
  }

  private handleIncoming(linkPeer: string, channel: ChannelLike): void {
    const host = this.host;
    if (!host) return;
    const parsed = parseLinkLabel(channel.label);
    const user = host.livePeers().find((link) => link.linkPeer === linkPeer)?.user;
    if (!parsed || !user) {
      this.closeChannel(channel);
      return;
    }
    channel.binaryType = "arraybuffer";
    const sender = new DataChannelOutbound(channel as unknown as RTCDataChannel, (error) => {
      this.ports.log("chan-send-failed", {
        roomKey: parsed.roomKey,
        linkPeer,
        error: String(error),
      });
      this.closeChannel(channel);
    });
    const record: InboundLive = {
      roomKey: parsed.roomKey,
      linkPeer,
      user,
      state: "await-hello",
      peer: null,
      access: "read",
      ticketAccess: "write",
      since: this.ports.now(),
      hello: null,
      sender,
      channel,
      needRosterSent: false,
    };
    this.inbound.set(channel, record);
    const reassemblyKey = `${linkPeer}|${channel.label}|in`;
    channel.onmessage = (event) => {
      const current = this.inbound.get(channel);
      if (!current) return;
      const text = ingestDataChannelData(this.reassembler, reassemblyKey, event.data);
      if (text === null) return;
      const frame = parseLinkFrame(text);
      if (!frame) return;
      if (current.state === "await-hello" && frame.t === "hello") {
        current.hello = frame;
        current.state = "verifying";
        current.since = this.ports.now();
        void this.verify(current);
        return;
      }
      if (current.state === "bound" && frame.t === "d" && current.peer) {
        const owner = this.rooms.get(current.roomKey)?.owner;
        const sink = owner ? this.sinks.get(owner) : undefined;
        sink?.message(current.roomKey, current.peer, frame.m, {
          user: current.user,
          access: current.access,
        });
      }
    };
    channel.onclose = () => {
      this.reassembler.dropRemote(reassemblyKey);
      this.inbound.delete(channel);
      this.publish(parsed.roomKey);
    };
  }

  private async verify(record: InboundLive): Promise<void> {
    const room = this.rooms.get(record.roomKey);
    if (!room || !record.hello) {
      this.safeSend(record.sender, { t: "reject", reason: "not-in-room" }, false);
      this.closeChannel(record.channel);
      this.ports.log("chan-reject-sent", {
        roomKey: record.roomKey,
        linkPeer: record.linkPeer,
        reason: "not-in-room",
      });
      return;
    }
    const cache = this.keyCaches.get(record.roomKey);
    const resolveKey = cache?.resolve ?? (async () => null as CryptoKey | null);
    const verdict = await verifyCollabHello({
      hello: record.hello,
      linkUser: record.user,
      room: room.state,
      resolveKey,
      nowSeconds: this.ports.nowSeconds?.(),
    });
    if (!this.inbound.has(record.channel) || record.state !== "verifying") return;
    if (verdict.ok === "need-roster") {
      if (!record.needRosterSent) {
        record.needRosterSent = true;
        this.sinks.get(room.owner)?.needRoster(record.roomKey);
      }
      return;
    }
    if (!verdict.ok) {
      this.safeSend(record.sender, { t: "reject", reason: verdict.reason }, false);
      this.closeChannel(record.channel);
      this.ports.log("chan-reject-sent", {
        roomKey: record.roomKey,
        linkPeer: record.linkPeer,
        reason: verdict.reason,
      });
      return;
    }
    for (const [channel, other] of [...this.inbound]) {
      if (other === record) continue;
      if (
        other.roomKey === record.roomKey &&
        other.state === "bound" &&
        other.peer === verdict.peer
      ) {
        this.inbound.delete(channel);
        this.closeChannel(channel);
      }
    }
    record.state = "bound";
    record.peer = verdict.peer;
    record.access = verdict.access;
    record.ticketAccess = verdict.ticketAccess;
    this.safeSend(record.sender, { t: "accept", peer: room.state.myPeerId }, false);
    this.ports.log("chan-accept", {
      roomKey: record.roomKey,
      linkPeer: record.linkPeer,
      peer: verdict.peer,
    });
    this.publish(record.roomKey);
  }

  private statesFor(roomKey: string): Array<[string, PeerChannelState]> {
    const states = new Map<string, PeerChannelState>();
    const room = this.rooms.get(roomKey)?.state;
    if (room) {
      for (const row of room.roster) {
        if (row.id === room.myPeerId) continue;
        states.set(row.id, { out: false, in: false });
      }
    }
    for (const record of this.outbound.values()) {
      if (record.roomKey !== roomKey || record.state !== "ready" || !record.acceptedPeer) continue;
      const current = states.get(record.acceptedPeer) ?? { out: false, in: false };
      current.out = true;
      states.set(record.acceptedPeer, current);
    }
    for (const record of this.inbound.values()) {
      if (record.roomKey !== roomKey || record.state !== "bound" || !record.peer) continue;
      const current = states.get(record.peer) ?? { out: false, in: false };
      current.in = true;
      states.set(record.peer, current);
    }
    return [...states.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  }

  private publish(roomKey: string): void {
    const entries = this.statesFor(roomKey);
    const serialized = JSON.stringify(entries);
    if (this.published.get(roomKey) === serialized) return;
    this.published.set(roomKey, serialized);
    const owner = this.rooms.get(roomKey)?.owner;
    if (!owner) return;
    this.sinks.get(owner)?.state(roomKey, entries);
  }

  private refreshKeyCache(state: RoomEndpointState): void {
    if (!state.jwk) {
      this.keyCaches.delete(state.roomKey);
      return;
    }
    const existing = this.keyCaches.get(state.roomKey);
    if (existing?.kid === state.jwk.kid) return;
    const jwk = state.jwk;
    this.keyCaches.set(state.roomKey, {
      kid: jwk.kid,
      resolve: createCollabTicketKeyCache(async (kid) => (kid === jwk.kid ? jwk : null)),
    });
  }

  /** An accepted peer must belong to the link's user when the roster knows it. */
  private acceptMatchesLink(roomKey: string, linkPeer: string, peer: string): boolean {
    const linkUser = this.host?.livePeers().find((link) => link.linkPeer === linkPeer)?.user;
    if (!linkUser) return false;
    const row = this.rooms.get(roomKey)?.state.roster.find((candidate) => candidate.id === peer);
    return !row || row.user === linkUser;
  }

  private closeChannel(channel: ChannelLike | null): void {
    if (!channel) return;
    try {
      channel.close();
    } catch {
      // ignore
    }
  }

  private safeSend(sender: DataChannelOutbound, message: unknown, binary: boolean): void {
    try {
      sender.sendJson(message, binary);
    } catch (error) {
      this.ports.log("chan-send-failed", { error: String(error) });
    }
  }
}
