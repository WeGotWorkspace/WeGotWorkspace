import {
  defaultLinkBusPorts,
  LinkBusFollower,
  LinkBusLeader,
  type LinkBusPorts,
} from "@/lib/rtc/link/link-channel-bus";
import { LinkChannelHub, type LinkChannelHubPorts } from "@/lib/rtc/link/link-channel-hub";
import type {
  LinkChannelClient,
  LinkHost,
  LinkRoomListener,
  LinkTrust,
  OwnerSink,
  PeerChannelState,
  RoomEndpointState,
} from "@/lib/rtc/link/link-channel-types";
import { createPrincipalTabId } from "@/presence-core/src/principal-tab-sync";

type Target = "local" | "bus" | "none";

const HEARTBEAT_MS = 5_000;

export class LinkChannelClientImpl implements LinkChannelClient {
  readonly tabId = createPrincipalTabId();

  private readonly rooms = new Map<string, RoomEndpointState>();

  private readonly listeners = new Map<string, Set<LinkRoomListener>>();

  private readonly states = new Map<string, Map<string, PeerChannelState>>();

  private readonly lastSent = new Map<string, string>();

  private heartbeat: unknown = null;

  private readonly follower: LinkBusFollower;

  constructor(
    private readonly hub: LinkChannelHub,
    private readonly ports: LinkBusPorts,
  ) {
    hub.setLocalOwner(this.tabId);
    hub.setSink(this.tabId, this.localSink());
    this.follower = new LinkBusFollower(
      this.tabId,
      {
        onLeaderChange: () => this.onTargetChange(),
        onRecv: (roomKey, from, msg, trust) => this.deliverMessage(roomKey, from, msg, trust),
        onState: (roomKey, entries) => this.applyState(roomKey, entries),
        onNeedRoster: (roomKey) => {
          for (const listener of this.listeners.get(roomKey) ?? []) listener.onNeedRoster();
        },
      },
      ports,
    );
  }

  available(): boolean {
    return this.target() !== "none";
  }

  setRoom(state: RoomEndpointState): void {
    this.rooms.set(state.roomKey, state);
    this.sendRoomIfNeeded(state);
  }

  removeRoom(roomKey: string): void {
    this.rooms.delete(roomKey);
    this.lastSent.delete(roomKey);
    this.states.delete(roomKey);
    const target = this.target();
    if (target === "local") this.hub.removeRoom(this.tabId, roomKey);
    else if (target === "bus") this.follower.postRoomRemove(roomKey);
  }

  kick(roomKey: string): void {
    const target = this.target();
    if (target === "local") this.hub.kick(roomKey);
    else if (target === "bus") this.follower.postKick(roomKey);
  }

  send(roomKey: string, toPeer: string, msg: unknown): boolean {
    const target = this.target();
    if (target === "local") return this.hub.send(roomKey, toPeer, msg);
    if (target === "bus") {
      this.follower.postSend(roomKey, toPeer, msg);
      return true;
    }
    return false;
  }

  broadcast(roomKey: string, msg: unknown): number {
    const target = this.target();
    if (target === "local") return this.hub.broadcast(roomKey, msg);
    if (target === "bus") {
      this.follower.postBroadcast(roomKey, msg);
      return this.rooms.has(roomKey) ? 1 : 0;
    }
    return 0;
  }

  peerStates(roomKey: string): ReadonlyMap<string, PeerChannelState> {
    return this.states.get(roomKey) ?? new Map();
  }

  subscribe(roomKey: string, listener: LinkRoomListener): () => void {
    let set = this.listeners.get(roomKey);
    if (!set) {
      set = new Set();
      this.listeners.set(roomKey, set);
    }
    set.add(listener);
    return () => set?.delete(listener);
  }

  onTargetChange(): void {
    this.lastSent.clear();
    for (const roomKey of this.rooms.keys()) {
      this.states.set(roomKey, new Map());
      for (const listener of this.listeners.get(roomKey) ?? []) {
        listener.onState(new Map());
      }
    }
    this.syncHeartbeat();
    for (const state of this.rooms.values()) this.sendRoomIfNeeded(state, true);
  }

  disposeFollower(): void {
    this.follower.dispose();
    if (this.heartbeat !== null) {
      this.ports.clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }

  private target(): Target {
    if (this.hub.hasHost()) return "local";
    if (this.follower.alive()) return "bus";
    return "none";
  }

  private localSink(): OwnerSink {
    return {
      message: (roomKey, from, msg, trust) => this.deliverMessage(roomKey, from, msg, trust),
      state: (roomKey, entries) => this.applyState(roomKey, entries),
      needRoster: (roomKey) => {
        for (const listener of this.listeners.get(roomKey) ?? []) listener.onNeedRoster();
      },
    };
  }

  private deliverMessage(roomKey: string, from: string, msg: unknown, trust: LinkTrust): void {
    for (const listener of this.listeners.get(roomKey) ?? []) {
      listener.onMessage(from, msg, trust);
    }
  }

  private applyState(roomKey: string, entries: Array<[string, PeerChannelState]>): void {
    const map = new Map(entries);
    this.states.set(roomKey, map);
    for (const listener of this.listeners.get(roomKey) ?? []) listener.onState(map);
  }

  private sendRoomIfNeeded(state: RoomEndpointState, force = false): void {
    const serialized = JSON.stringify(state);
    if (!force && this.lastSent.get(state.roomKey) === serialized) return;
    const target = this.target();
    if (target === "none") return;
    this.lastSent.set(state.roomKey, serialized);
    if (target === "local") this.hub.setRoom(this.tabId, state);
    else this.follower.postRoom(state);
  }

  private syncHeartbeat(): void {
    if (this.heartbeat !== null) {
      this.ports.clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    if (this.target() !== "bus") return;
    this.heartbeat = this.ports.setInterval(() => {
      if (this.target() !== "bus") return;
      for (const state of this.rooms.values()) this.follower.postRoom(state);
    }, HEARTBEAT_MS);
  }
}

let hubSingleton: LinkChannelHub | null = null;
let clientSingleton: LinkChannelClientImpl | null = null;
let leader: LinkBusLeader | null = null;
let busPorts: LinkBusPorts = defaultLinkBusPorts();

function hubPorts(): LinkChannelHubPorts {
  return {
    now: () => Date.now(),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
    log: () => undefined,
  };
}

export function getLinkChannelHub(): LinkChannelHub {
  hubSingleton ??= new LinkChannelHub(hubPorts());
  return hubSingleton;
}

export function getLinkChannelClient(): LinkChannelClient {
  clientSingleton ??= new LinkChannelClientImpl(getLinkChannelHub(), busPorts);
  return clientSingleton;
}

/** Called by PresenceRtcSession after its join. Starts the bus leader. */
export function attachLinkHost(host: LinkHost): void {
  const hub = getLinkChannelHub();
  const client = getLinkChannelClient() as LinkChannelClientImpl;
  hub.attachHost(host);
  leader ??= new LinkBusLeader(hub, busPorts);
  leader.start(client.tabId);
  client.onTargetChange();
}

/** Called by PresenceRtcSession on leave. Stops the bus leader. */
export function detachLinkHost(host: LinkHost): void {
  const hub = getLinkChannelHub();
  const client = getLinkChannelClient() as LinkChannelClientImpl;
  leader?.stop();
  leader = null;
  hub.detachHost(host);
  client.onTargetChange();
}

export function resetLinkChannelsForTests(ports?: LinkBusPorts): void {
  leader?.stop();
  leader = null;
  clientSingleton?.disposeFollower();
  clientSingleton = null;
  hubSingleton = null;
  busPorts = ports ?? defaultLinkBusPorts();
}
