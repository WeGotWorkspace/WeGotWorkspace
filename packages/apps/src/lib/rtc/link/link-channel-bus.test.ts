import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LINK_CHANNELS_BUS_NAME,
  type LinkBusChannel,
  type LinkBusMessage,
  type LinkBusPorts,
} from "@/lib/rtc/link/link-channel-bus";
import {
  attachLinkHost,
  detachLinkHost,
  getLinkChannelClient,
  getLinkChannelHub,
  resetLinkChannelsForTests,
} from "@/lib/rtc/link/link-channel-client";
import type {
  LinkHost,
  LinkRoomListener,
  PeerChannelState,
  RoomEndpointState,
} from "@/lib/rtc/link/link-channel-types";

const ROOM = "c".repeat(40);

type BusInstance = LinkBusChannel & { name: string; closed: boolean };

function createMemoryBus(): LinkBusPorts["createChannel"] {
  const instances = new Set<BusInstance>();
  return (name: string) => {
    const instance: BusInstance = {
      name,
      closed: false,
      onmessage: null,
      postMessage(m: unknown) {
        if (this.closed) return;
        for (const other of instances) {
          if (other === this || other.closed || other.name !== name) continue;
          queueMicrotask(() => {
            other.onmessage?.({ data: m } as MessageEvent);
          });
        }
      },
      close() {
        this.closed = true;
        instances.delete(this);
      },
    };
    instances.add(instance);
    return instance;
  };
}

function room(myPeerId: string): RoomEndpointState {
  return {
    kind: "collab",
    roomKey: ROOM,
    myPeerId,
    jwk: null,
    roster: [
      { id: myPeerId, user: "alice", access: "write" },
      { id: "peer-b", user: "bob", access: "write" },
    ],
  };
}

function fakeHost(hasHost = true): LinkHost {
  const links = new Set<() => void>();
  return {
    livePeers: () => (hasHost ? [{ linkPeer: "B", user: "bob" }] : []),
    createChannel: () => null,
    peerAdvertisesBin: () => false,
    onIncomingChannel: () => () => undefined,
    onLinksChanged: (listener) => {
      links.add(listener);
      return () => links.delete(listener);
    },
  };
}

async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(0);
}

describe("link channel bus", () => {
  let createChannel: LinkBusPorts["createChannel"];

  beforeEach(() => {
    vi.useFakeTimers();
    createChannel = createMemoryBus();
    resetLinkChannelsForTests({
      createChannel,
      now: () => Date.now(),
      setInterval: (fn, ms) => setInterval(fn, ms),
      clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
    });
  });

  afterEach(() => {
    resetLinkChannelsForTests();
    vi.useRealTimers();
  });

  it("a follower tab reaches the leader hub", async () => {
    const leaderHost = fakeHost();
    attachLinkHost(leaderHost);
    const leaderHub = getLinkChannelHub();

    // Follower client in a separate singleton reset is not possible; simulate by
    // constructing a second client through the bus with a fresh follower path.
    // The module singleton is the leader window's client; use a second bus peer
    // posting room messages and reading state replies.
    const followerTab = "follower-tab";
    const followerChannel = createChannel(LINK_CHANNELS_BUS_NAME)!;
    const states: Array<Array<[string, PeerChannelState]>> = [];
    followerChannel.onmessage = (event) => {
      const data = event.data as LinkBusMessage;
      if (data.t === "state" && data.toTab === followerTab) states.push(data.states);
    };

    followerChannel.postMessage({
      t: "room",
      fromTab: followerTab,
      state: room("peer-f"),
    } satisfies LinkBusMessage);
    await settle();

    expect(leaderHub.peerStates(ROOM).has("peer-b")).toBe(true);
    // Owner F's room is on the hub.
    expect(
      (leaderHub as unknown as { rooms: Map<string, { owner: string }> }).rooms.get(ROOM)?.owner,
    ).toBe(followerTab);

    // Push a state from the hub sink by publishing via setRoom again after attach.
    const sinkOwner = (
      leaderHub as unknown as {
        sinks: Map<
          string,
          { state: (roomKey: string, states: Array<[string, PeerChannelState]>) => void }
        >;
      }
    ).sinks.get(followerTab);
    sinkOwner?.state(ROOM, [["peer-b", { out: true, in: false }]]);
    await settle();
    expect(states.at(-1)).toEqual([["peer-b", { out: true, in: false }]]);

    detachLinkHost(leaderHost);
  });

  it("a follower re-registers when the leader changes", async () => {
    const create = createChannel;
    const followerPosts: LinkBusMessage[] = [];
    const spyCreate: LinkBusPorts["createChannel"] = (name) => {
      const ch = create(name)!;
      const original = ch.postMessage.bind(ch);
      ch.postMessage = (m: unknown) => {
        const msg = m as LinkBusMessage;
        if (msg.t === "room") followerPosts.push(msg);
        original(m);
      };
      return ch;
    };
    resetLinkChannelsForTests({
      createChannel: spyCreate,
      now: () => Date.now(),
      setInterval: (fn, ms) => setInterval(fn, ms),
      clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
    });

    // Window F: client without a host (follower).
    const follower = getLinkChannelClient();
    follower.setRoom(room("peer-f"));

    // Leader L1 comes up on the bus.
    const l1 = spyCreate(LINK_CHANNELS_BUS_NAME)!;
    l1.postMessage({ t: "hub-up", leaderTab: "L1" } satisfies LinkBusMessage);
    await settle();
    expect(follower.available()).toBe(true);

    // Heartbeat / target change should have posted rooms.
    const before = followerPosts.length;
    expect(before).toBeGreaterThan(0);

    // L1 stops, L2 starts.
    l1.postMessage({ t: "hub-down", leaderTab: "L1" } satisfies LinkBusMessage);
    await settle();
    const l2 = spyCreate(LINK_CHANNELS_BUS_NAME)!;
    l2.postMessage({ t: "hub-up", leaderTab: "L2" } satisfies LinkBusMessage);
    await settle();
    expect(followerPosts.length).toBeGreaterThan(before);

    // Also within one heartbeat.
    await vi.advanceTimersByTimeAsync(5_000);
    await settle();
    expect(followerPosts.some((msg) => msg.t === "room")).toBe(true);
  });

  it("a leader expires rooms of a silent follower after 15 s", async () => {
    const host = fakeHost();
    attachLinkHost(host);
    const hub = getLinkChannelHub();
    const followerTab = "silent-f";
    const followerChannel = createChannel(LINK_CHANNELS_BUS_NAME)!;
    followerChannel.postMessage({
      t: "room",
      fromTab: followerTab,
      state: room("peer-f"),
    } satisfies LinkBusMessage);
    await settle();
    expect((hub as unknown as { rooms: Map<string, unknown> }).rooms.has(ROOM)).toBe(true);

    await vi.advanceTimersByTimeAsync(16_000);
    await settle();
    expect((hub as unknown as { rooms: Map<string, unknown> }).rooms.has(ROOM)).toBe(false);
    detachLinkHost(host);
  });

  it("a follower without a live leader is not available", async () => {
    const client = getLinkChannelClient();
    expect(client.available()).toBe(false);
    client.setRoom(room("peer-f"));
    expect(client.available()).toBe(false);
  });

  it("the leader window's own client uses the hub directly", async () => {
    const host = fakeHost();
    const busTraffic: LinkBusMessage[] = [];
    const probe = createChannel(LINK_CHANNELS_BUS_NAME)!;
    probe.onmessage = (event) => busTraffic.push(event.data as LinkBusMessage);

    attachLinkHost(host);
    const client = getLinkChannelClient();
    const listener: LinkRoomListener = {
      onMessage: vi.fn(),
      onState: vi.fn(),
      onNeedRoster: vi.fn(),
    };
    client.subscribe(ROOM, listener);
    client.setRoom(room("peer-a"));
    await settle();

    const roomPosts = busTraffic.filter(
      (msg) =>
        msg.t === "room" &&
        "fromTab" in msg &&
        msg.fromTab === (client as unknown as { tabId: string }).tabId,
    );
    expect(roomPosts).toEqual([]);
    expect(getLinkChannelHub().peerStates(ROOM).has("peer-b")).toBe(true);
    detachLinkHost(host);
  });
});
