import type { LinkChannelHub } from "@/lib/rtc/link/link-channel-hub";
import type {
  LinkTrust,
  OwnerSink,
  PeerChannelState,
  RoomEndpointState,
} from "@/lib/rtc/link/link-channel-types";

export const LINK_CHANNELS_BUS_NAME = "wgw.link.channels";
export const LINK_BUS_HUB_UP_MS = 2_000;
export const LINK_BUS_LEADER_ALIVE_MS = 6_000;

export type LinkBusMessage =
  | { t: "hub-up"; leaderTab: string }
  | { t: "hub-down"; leaderTab: string }
  | { t: "room"; fromTab: string; state: RoomEndpointState }
  | { t: "room-remove"; fromTab: string; roomKey: string }
  | { t: "send"; fromTab: string; roomKey: string; to: string; msg: unknown }
  | { t: "broadcast"; fromTab: string; roomKey: string; msg: unknown }
  | { t: "kick"; fromTab: string; roomKey: string }
  | { t: "recv"; toTab: string; roomKey: string; from: string; msg: unknown; trust: LinkTrust }
  | { t: "state"; toTab: string; roomKey: string; states: Array<[string, PeerChannelState]> }
  | { t: "need-roster"; toTab: string; roomKey: string };

export type LinkBusChannel = {
  postMessage(m: unknown): void;
  onmessage: ((e: MessageEvent) => void) | null;
  close(): void;
};

export type LinkBusPorts = {
  createChannel: (name: string) => LinkBusChannel | null;
  now: () => number;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
};

export function defaultLinkBusPorts(): LinkBusPorts {
  return {
    createChannel: (name) =>
      typeof BroadcastChannel === "function" ? new BroadcastChannel(name) : null,
    now: () => Date.now(),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
  };
}

function isBusMessage(value: unknown): value is LinkBusMessage {
  return (
    !!value &&
    typeof value === "object" &&
    "t" in value &&
    typeof (value as { t: unknown }).t === "string"
  );
}

export class LinkBusLeader {
  private channel: LinkBusChannel | null = null;

  private tick: unknown = null;

  private tabId: string | null = null;

  private readonly followerSinks = new Set<string>();

  constructor(
    private readonly hub: LinkChannelHub,
    private readonly ports: LinkBusPorts = defaultLinkBusPorts(),
  ) {}

  start(tabId: string): void {
    this.stop();
    this.tabId = tabId;
    this.channel = this.ports.createChannel(LINK_CHANNELS_BUS_NAME);
    if (!this.channel) return;
    this.channel.onmessage = (event) => this.onMessage(event.data);
    this.post({ t: "hub-up", leaderTab: tabId });
    this.tick = this.ports.setInterval(() => {
      if (!this.tabId) return;
      this.post({ t: "hub-up", leaderTab: this.tabId });
    }, LINK_BUS_HUB_UP_MS);
  }

  stop(): void {
    if (this.tabId) this.post({ t: "hub-down", leaderTab: this.tabId });
    if (this.tick !== null) {
      this.ports.clearInterval(this.tick);
      this.tick = null;
    }
    for (const owner of this.followerSinks) this.hub.removeSink(owner);
    this.followerSinks.clear();
    this.channel?.close();
    this.channel = null;
    this.tabId = null;
  }

  private onMessage(data: unknown): void {
    if (!isBusMessage(data) || !this.tabId) return;
    if ("fromTab" in data && data.fromTab === this.tabId) return;
    switch (data.t) {
      case "room":
        this.ensureSink(data.fromTab);
        this.hub.setRoom(data.fromTab, data.state);
        break;
      case "room-remove":
        this.hub.removeRoom(data.fromTab, data.roomKey);
        break;
      case "kick":
        this.hub.kick(data.roomKey);
        break;
      case "send":
        this.hub.send(data.roomKey, data.to, data.msg);
        break;
      case "broadcast":
        this.hub.broadcast(data.roomKey, data.msg);
        break;
      default:
        break;
    }
  }

  private ensureSink(fromTab: string): void {
    if (this.followerSinks.has(fromTab)) return;
    this.followerSinks.add(fromTab);
    const sink: OwnerSink = {
      message: (roomKey, from, msg, trust) => {
        this.post({ t: "recv", toTab: fromTab, roomKey, from, msg, trust });
      },
      state: (roomKey, states) => {
        this.post({ t: "state", toTab: fromTab, roomKey, states });
      },
      needRoster: (roomKey) => {
        this.post({ t: "need-roster", toTab: fromTab, roomKey });
      },
    };
    this.hub.setSink(fromTab, sink);
  }

  private post(message: LinkBusMessage): void {
    try {
      this.channel?.postMessage(message);
    } catch {
      // ignore
    }
  }
}

export type LinkBusFollowerCallbacks = {
  onLeaderChange: () => void;
  onRecv: (roomKey: string, from: string, msg: unknown, trust: LinkTrust) => void;
  onState: (roomKey: string, states: Array<[string, PeerChannelState]>) => void;
  onNeedRoster: (roomKey: string) => void;
};

export class LinkBusFollower {
  private channel: LinkBusChannel | null = null;

  private leaderTab: string | null = null;

  private lastHubUpAt = 0;

  constructor(
    private readonly myTab: string,
    private readonly callbacks: LinkBusFollowerCallbacks,
    private readonly ports: LinkBusPorts = defaultLinkBusPorts(),
  ) {
    this.channel = this.ports.createChannel(LINK_CHANNELS_BUS_NAME);
    if (this.channel) {
      this.channel.onmessage = (event) => this.onMessage(event.data);
    }
  }

  alive(): boolean {
    return this.ports.now() - this.lastHubUpAt < LINK_BUS_LEADER_ALIVE_MS;
  }

  leader(): string | null {
    return this.alive() ? this.leaderTab : null;
  }

  postRoom(state: RoomEndpointState): void {
    this.post({ t: "room", fromTab: this.myTab, state });
  }

  postRoomRemove(roomKey: string): void {
    this.post({ t: "room-remove", fromTab: this.myTab, roomKey });
  }

  postSend(roomKey: string, to: string, msg: unknown): void {
    this.post({ t: "send", fromTab: this.myTab, roomKey, to, msg });
  }

  postBroadcast(roomKey: string, msg: unknown): void {
    this.post({ t: "broadcast", fromTab: this.myTab, roomKey, msg });
  }

  postKick(roomKey: string): void {
    this.post({ t: "kick", fromTab: this.myTab, roomKey });
  }

  dispose(): void {
    this.channel?.close();
    this.channel = null;
  }

  private onMessage(data: unknown): void {
    if (!isBusMessage(data)) return;
    if (data.t === "hub-up") {
      if (data.leaderTab === this.myTab) return;
      const changed = this.leaderTab !== data.leaderTab || !this.alive();
      this.leaderTab = data.leaderTab;
      this.lastHubUpAt = this.ports.now();
      if (changed) this.callbacks.onLeaderChange();
      return;
    }
    if (data.t === "hub-down") {
      if (data.leaderTab !== this.leaderTab) return;
      this.lastHubUpAt = 0;
      this.callbacks.onLeaderChange();
      return;
    }
    if (!("toTab" in data) || data.toTab !== this.myTab) return;
    if (data.t === "recv") this.callbacks.onRecv(data.roomKey, data.from, data.msg, data.trust);
    else if (data.t === "state") this.callbacks.onState(data.roomKey, data.states);
    else if (data.t === "need-roster") this.callbacks.onNeedRoster(data.roomKey);
  }

  private post(message: LinkBusMessage): void {
    try {
      this.channel?.postMessage(message);
    } catch {
      // ignore
    }
  }
}
