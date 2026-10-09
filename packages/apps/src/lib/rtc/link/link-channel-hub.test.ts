import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LinkChannelHub } from "@/lib/rtc/link/link-channel-hub";
import type {
  ChannelLike,
  LinkHost,
  OwnerSink,
  PeerChannelState,
  RoomEndpointState,
} from "@/lib/rtc/link/link-channel-types";
import type { DocsCollabTicketJwk } from "@/text-editor-core/docs-collab/docs-collab-ticket";

const ROOM = "a".repeat(40);

type FakeEnd = ChannelLike & {
  _peer: FakeEnd | null;
  _closedOnce: boolean;
};

class FakeLinkNet {
  private readonly hosts = new Map<
    string,
    {
      user: string;
      live: Map<string, string>;
      incoming: Set<(linkPeer: string, channel: ChannelLike) => void>;
      links: Set<() => void>;
    }
  >();

  add(id: string, user: string): LinkHost {
    const entry = {
      user,
      live: new Map<string, string>(),
      incoming: new Set<(linkPeer: string, channel: ChannelLike) => void>(),
      links: new Set<() => void>(),
    };
    this.hosts.set(id, entry);
    return {
      livePeers: () =>
        [...entry.live.entries()].map(([linkPeer, remoteUser]) => ({
          linkPeer,
          user: remoteUser,
        })),
      createChannel: (linkPeer, label) => this.createChannel(id, linkPeer, label),
      peerAdvertisesBin: () => false,
      onIncomingChannel: (listener) => {
        entry.incoming.add(listener);
        return () => entry.incoming.delete(listener);
      },
      onLinksChanged: (listener) => {
        entry.links.add(listener);
        return () => entry.links.delete(listener);
      },
    };
  }

  link(a: string, b: string, up: boolean): void {
    const left = this.hosts.get(a);
    const right = this.hosts.get(b);
    if (!left || !right) throw new Error("unknown host");
    if (up) {
      left.live.set(b, right.user);
      right.live.set(a, left.user);
    } else {
      left.live.delete(b);
      right.live.delete(a);
      for (const pair of this.openPairs) {
        if ((pair.a === a && pair.b === b) || (pair.a === b && pair.b === a)) {
          pair.left.close();
        }
      }
    }
    for (const listener of left.links) listener();
    for (const listener of right.links) listener();
  }

  private readonly openPairs: Array<{ a: string; b: string; left: FakeEnd; right: FakeEnd }> = [];

  private createChannel(from: string, to: string, label: string): ChannelLike {
    const remote = this.hosts.get(to);
    if (!remote) return null as unknown as ChannelLike;
    const makeEnd = (): FakeEnd => {
      const end: FakeEnd = {
        label,
        readyState: "connecting",
        binaryType: "blob",
        bufferedAmount: 0,
        bufferedAmountLowThreshold: 0,
        onopen: null,
        onmessage: null,
        onclose: null,
        _peer: null,
        _closedOnce: false,
        send(data) {
          if (this.readyState !== "open" || !this._peer) return;
          const payload = data;
          queueMicrotask(() => {
            this._peer?.onmessage?.({ data: payload } as MessageEvent);
          });
        },
        close() {
          if (this._closedOnce) return;
          this._closedOnce = true;
          const peer = this._peer;
          this.readyState = "closed";
          if (peer && !peer._closedOnce) {
            peer._closedOnce = true;
            peer.readyState = "closed";
            queueMicrotask(() => {
              this.onclose?.(new Event("close"));
              peer.onclose?.(new Event("close"));
            });
          } else {
            queueMicrotask(() => this.onclose?.(new Event("close")));
          }
        },
        addEventListener() {},
        removeEventListener() {},
      };
      return end;
    };
    const left = makeEnd();
    const right = makeEnd();
    left._peer = right;
    right._peer = left;
    this.openPairs.push({ a: from, b: to, left, right });
    for (const listener of remote.incoming) listener(from, right);
    queueMicrotask(() => {
      left.readyState = "open";
      right.readyState = "open";
      left.onopen?.(new Event("open"));
      right.onopen?.(new Event("open"));
    });
    return left;
  }
}

async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(0);
}

function room(
  myPeerId: string,
  roster: RoomEndpointState["roster"],
  overrides: Partial<RoomEndpointState> = {},
): RoomEndpointState {
  return {
    kind: "collab",
    roomKey: ROOM,
    myPeerId,
    jwk: null,
    roster,
    ...overrides,
  };
}

function makeHub() {
  const log = vi.fn();
  const hub = new LinkChannelHub({
    now: () => Date.now(),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
    log,
  });
  return { hub, log };
}

function sinkRecorder() {
  const messages: Array<{ from: string; msg: unknown; access: string }> = [];
  const states: Array<Array<[string, PeerChannelState]>> = [];
  const needRoster: string[] = [];
  const sink: OwnerSink = {
    message: (_room, from, msg, trust) => {
      messages.push({ from, msg, access: trust.access });
    },
    state: (_room, next) => {
      states.push(next);
    },
    needRoster: (roomKey) => {
      needRoster.push(roomKey);
    },
  };
  return { sink, messages, states, needRoster };
}

describe("LinkChannelHub", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("two rostered browsers become live in both directions", async () => {
    const net = new FakeLinkNet();
    const hostA = net.add("A", "alice");
    const hostB = net.add("B", "bob");
    const { hub: hubA } = makeHub();
    const { hub: hubB } = makeHub();
    const sinkA = sinkRecorder();
    const sinkB = sinkRecorder();
    hubA.setLocalOwner("tab-a");
    hubB.setLocalOwner("tab-b");
    hubA.setSink("tab-a", sinkA.sink);
    hubB.setSink("tab-b", sinkB.sink);
    hubA.attachHost(hostA);
    hubB.attachHost(hostB);
    hubA.setRoom(
      "tab-a",
      room("peer-a", [
        { id: "peer-a", user: "alice", access: "write" },
        { id: "peer-b", user: "bob", access: "write" },
      ]),
    );
    hubB.setRoom(
      "tab-b",
      room("peer-b", [
        { id: "peer-a", user: "alice", access: "write" },
        { id: "peer-b", user: "bob", access: "write" },
      ]),
    );
    net.link("A", "B", true);
    await settle();

    expect(hubA.peerStates(ROOM).get("peer-b")).toEqual({ out: true, in: true });
    expect(hubB.peerStates(ROOM).get("peer-a")).toEqual({ out: true, in: true });
    expect(hubA.send(ROOM, "peer-b", { hello: 1 })).toBe(true);
    await settle();
    expect(sinkB.messages).toEqual([{ from: "peer-a", msg: { hello: 1 }, access: "write" }]);
  });

  it("a browser without the room rejects, and kick retries", async () => {
    const net = new FakeLinkNet();
    const hostA = net.add("A", "alice");
    const hostB = net.add("B", "bob");
    const { hub: hubA } = makeHub();
    const { hub: hubB } = makeHub();
    hubA.setLocalOwner("tab-a");
    hubB.setLocalOwner("tab-b");
    hubA.setSink("tab-a", sinkRecorder().sink);
    hubB.setSink("tab-b", sinkRecorder().sink);
    hubA.attachHost(hostA);
    hubB.attachHost(hostB);
    hubA.setRoom(
      "tab-a",
      room("peer-a", [
        { id: "peer-a", user: "alice", access: "write" },
        { id: "peer-b", user: "bob", access: "write" },
      ]),
    );
    net.link("A", "B", true);
    await settle();
    expect(hubA.peerStates(ROOM).get("peer-b")).toEqual({ out: false, in: false });

    hubB.setRoom(
      "tab-b",
      room("peer-b", [
        { id: "peer-a", user: "alice", access: "write" },
        { id: "peer-b", user: "bob", access: "write" },
      ]),
    );
    await settle();
    expect(hubA.peerStates(ROOM).get("peer-b")?.out).toBe(false);

    hubA.kick(ROOM);
    await settle();
    expect(hubA.peerStates(ROOM).get("peer-b")).toEqual({ out: true, in: true });
    expect(hubB.peerStates(ROOM).get("peer-a")).toEqual({ out: true, in: true });
  });

  it("a dropped link closes channels and they come back when the link returns", async () => {
    const net = new FakeLinkNet();
    const hostA = net.add("A", "alice");
    const hostB = net.add("B", "bob");
    const { hub: hubA } = makeHub();
    const { hub: hubB } = makeHub();
    hubA.setLocalOwner("tab-a");
    hubB.setLocalOwner("tab-b");
    hubA.setSink("tab-a", sinkRecorder().sink);
    hubB.setSink("tab-b", sinkRecorder().sink);
    hubA.attachHost(hostA);
    hubB.attachHost(hostB);
    const roster = [
      { id: "peer-a", user: "alice", access: "write" as const },
      { id: "peer-b", user: "bob", access: "write" as const },
    ];
    hubA.setRoom("tab-a", room("peer-a", roster));
    hubB.setRoom("tab-b", room("peer-b", roster));
    net.link("A", "B", true);
    await settle();
    expect(hubA.peerStates(ROOM).get("peer-b")).toEqual({ out: true, in: true });

    net.link("A", "B", false);
    await settle();
    expect(hubA.peerStates(ROOM).get("peer-b")).toEqual({ out: false, in: false });

    await vi.advanceTimersByTimeAsync(5_000);
    net.link("A", "B", true);
    await settle();
    expect(hubA.peerStates(ROOM).get("peer-b")).toEqual({ out: true, in: true });
  });

  it("a revoked peer is closed on the receiving side", async () => {
    const net = new FakeLinkNet();
    const hostA = net.add("A", "alice");
    const hostB = net.add("B", "bob");
    const { hub: hubA } = makeHub();
    const { hub: hubB } = makeHub();
    const sinkB = sinkRecorder();
    hubA.setLocalOwner("tab-a");
    hubB.setLocalOwner("tab-b");
    hubA.setSink("tab-a", sinkRecorder().sink);
    hubB.setSink("tab-b", sinkB.sink);
    hubA.attachHost(hostA);
    hubB.attachHost(hostB);
    const roster = [
      { id: "peer-a", user: "alice", access: "write" as const },
      { id: "peer-b", user: "bob", access: "write" as const },
    ];
    hubA.setRoom("tab-a", room("peer-a", roster));
    hubB.setRoom("tab-b", room("peer-b", roster));
    net.link("A", "B", true);
    await settle();

    hubB.setRoom("tab-b", room("peer-b", [{ id: "peer-b", user: "bob", access: "write" }]));
    await settle();
    expect(hubA.peerStates(ROOM).get("peer-b")?.out).toBe(false);

    await vi.advanceTimersByTimeAsync(5_000);
    await settle();
    await vi.advanceTimersByTimeAsync(2_000);
    await settle();
    expect(sinkB.needRoster).toEqual([ROOM]);
  });

  it("a hello from a different user is rejected", async () => {
    const net = new FakeLinkNet();
    const hostA = net.add("A", "alice");
    const hostB = net.add("B", "bob");
    const { hub: hubA, log: logA } = makeHub();
    const { hub: hubB, log: logB } = makeHub();
    hubA.setLocalOwner("tab-a");
    hubB.setLocalOwner("tab-b");
    hubA.setSink("tab-a", sinkRecorder().sink);
    hubB.setSink("tab-b", sinkRecorder().sink);
    hubA.attachHost(hostA);
    hubB.attachHost(hostB);
    hubA.setRoom(
      "tab-a",
      room("peer-a", [
        { id: "peer-a", user: "alice", access: "write" },
        { id: "peer-b", user: "bob", access: "write" },
      ]),
    );
    hubB.setRoom(
      "tab-b",
      room("peer-b", [
        { id: "peer-a", user: "carol", access: "write" },
        { id: "peer-b", user: "bob", access: "write" },
      ]),
    );
    net.link("A", "B", true);
    await settle();
    expect(
      logB.mock.calls.some(
        (call) => call[0] === "chan-reject-sent" && call[1]?.reason === "user-mismatch",
      ),
    ).toBe(true);
    expect(
      logA.mock.calls.some(
        (call) => call[0] === "chan-reject" && call[1]?.reason === "user-mismatch",
      ),
    ).toBe(true);
    expect(hubA.peerStates(ROOM).get("peer-b")?.out).toBe(false);
  });

  it("a published key requires a valid ticket", async () => {
    const net = new FakeLinkNet();
    const hostA = net.add("A", "alice");
    const hostB = net.add("B", "bob");
    const { hub: hubA, log } = makeHub();
    const { hub: hubB } = makeHub();
    hubA.setLocalOwner("tab-a");
    hubB.setLocalOwner("tab-b");
    hubA.setSink("tab-a", sinkRecorder().sink);
    hubB.setSink("tab-b", sinkRecorder().sink);
    hubA.attachHost(hostA);
    hubB.attachHost(hostB);
    const jwk: DocsCollabTicketJwk = {
      kty: "EC",
      crv: "P-256",
      x: "x",
      y: "y",
      kid: "kid1",
    };
    const roster = [
      { id: "peer-a", user: "alice", access: "write" as const },
      { id: "peer-b", user: "bob", access: "write" as const },
    ];
    hubA.setRoom("tab-a", room("peer-a", roster));
    hubB.setRoom("tab-b", room("peer-b", roster, { jwk }));
    net.link("A", "B", true);
    await settle();
    expect(
      log.mock.calls.some(
        (call) => call[0] === "chan-reject" && call[1]?.reason === "ticket-rejected",
      ),
    ).toBe(true);
  });

  it("two browsers of one user are separate peers", async () => {
    const net = new FakeLinkNet();
    const hostA = net.add("A", "alice");
    const hostB = net.add("B", "bob");
    const hostB2 = net.add("B2", "bob");
    const { hub: hubA } = makeHub();
    const { hub: hubB } = makeHub();
    const { hub: hubB2 } = makeHub();
    hubA.setLocalOwner("tab-a");
    hubB.setLocalOwner("tab-b");
    hubB2.setLocalOwner("tab-b2");
    hubA.setSink("tab-a", sinkRecorder().sink);
    hubB.setSink("tab-b", sinkRecorder().sink);
    hubB2.setSink("tab-b2", sinkRecorder().sink);
    hubA.attachHost(hostA);
    hubB.attachHost(hostB);
    hubB2.attachHost(hostB2);
    const roster = [
      { id: "peer-a", user: "alice", access: "write" as const },
      { id: "peer-b", user: "bob", access: "write" as const },
      { id: "peer-b2", user: "bob", access: "write" as const },
    ];
    hubA.setRoom("tab-a", room("peer-a", roster));
    hubB.setRoom("tab-b", room("peer-b", roster));
    hubB2.setRoom("tab-b2", room("peer-b2", roster));
    net.link("A", "B", true);
    net.link("A", "B2", true);
    await settle();
    expect(hubA.peerStates(ROOM).get("peer-b")).toEqual({ out: true, in: true });
    expect(hubA.peerStates(ROOM).get("peer-b2")).toEqual({ out: true, in: true });
  });

  it("a browser of the user without the room does not block the other", async () => {
    const net = new FakeLinkNet();
    const hostA = net.add("A", "alice");
    const hostB = net.add("B", "bob");
    const hostB2 = net.add("B2", "bob");
    const { hub: hubA } = makeHub();
    const { hub: hubB } = makeHub();
    const { hub: hubB2 } = makeHub();
    hubA.setLocalOwner("tab-a");
    hubB.setLocalOwner("tab-b");
    hubB2.setLocalOwner("tab-b2");
    hubA.setSink("tab-a", sinkRecorder().sink);
    hubB.setSink("tab-b", sinkRecorder().sink);
    hubB2.setSink("tab-b2", sinkRecorder().sink);
    hubA.attachHost(hostA);
    hubB.attachHost(hostB);
    hubB2.attachHost(hostB2);
    const roster = [
      { id: "peer-a", user: "alice", access: "write" as const },
      { id: "peer-b", user: "bob", access: "write" as const },
      { id: "peer-b2", user: "bob", access: "write" as const },
    ];
    hubA.setRoom("tab-a", room("peer-a", roster));
    hubB.setRoom("tab-b", room("peer-b", roster));
    net.link("A", "B", true);
    net.link("A", "B2", true);
    await settle();
    expect(hubA.peerStates(ROOM).get("peer-b")).toEqual({ out: true, in: true });
    expect(hubA.peerStates(ROOM).get("peer-b2")?.out).toBe(false);
  });

  it("data on an outbound channel is ignored", async () => {
    const net = new FakeLinkNet();
    const hostA = net.add("A", "alice");
    const hostB = net.add("B", "bob");
    const { hub: hubA } = makeHub();
    const { hub: hubB } = makeHub();
    const sinkA = sinkRecorder();
    hubA.setLocalOwner("tab-a");
    hubB.setLocalOwner("tab-b");
    hubA.setSink("tab-a", sinkA.sink);
    hubB.setSink("tab-b", sinkRecorder().sink);
    hubA.attachHost(hostA);
    hubB.attachHost(hostB);
    const roster = [
      { id: "peer-a", user: "alice", access: "write" as const },
      { id: "peer-b", user: "bob", access: "write" as const },
    ];
    hubA.setRoom("tab-a", room("peer-a", roster));
    hubB.setRoom("tab-b", room("peer-b", roster));
    net.link("A", "B", true);
    await settle();

    const outbound = [
      ...(hubA as unknown as { outbound: Map<string, { channel: FakeEnd }> }).outbound.values(),
    ][0];
    outbound?.channel?._peer?.send(JSON.stringify({ t: "d", m: { sneaky: 1 } }));
    await settle();
    expect(sinkA.messages).toEqual([]);
  });

  it("detaching the host closes everything and reports all peers down", async () => {
    const net = new FakeLinkNet();
    const hostA = net.add("A", "alice");
    const hostB = net.add("B", "bob");
    const { hub: hubA } = makeHub();
    const { hub: hubB } = makeHub();
    const sinkA = sinkRecorder();
    hubA.setLocalOwner("tab-a");
    hubB.setLocalOwner("tab-b");
    hubA.setSink("tab-a", sinkA.sink);
    hubB.setSink("tab-b", sinkRecorder().sink);
    hubA.attachHost(hostA);
    hubB.attachHost(hostB);
    const roster = [
      { id: "peer-a", user: "alice", access: "write" as const },
      { id: "peer-b", user: "bob", access: "write" as const },
    ];
    hubA.setRoom("tab-a", room("peer-a", roster));
    hubB.setRoom("tab-b", room("peer-b", roster));
    net.link("A", "B", true);
    await settle();
    hubA.detachHost(hostA);
    await settle();
    expect(hubA.hasHost()).toBe(false);
    expect(hubA.peerStates(ROOM).get("peer-b")).toEqual({ out: false, in: false });
    expect(sinkA.states.at(-1)).toEqual([["peer-b", { out: false, in: false }]]);
  });

  it("setRoom revalidates access", async () => {
    const net = new FakeLinkNet();
    const hostA = net.add("A", "alice");
    const hostB = net.add("B", "bob");
    const { hub: hubA } = makeHub();
    const { hub: hubB } = makeHub();
    const sinkB = sinkRecorder();
    hubA.setLocalOwner("tab-a");
    hubB.setLocalOwner("tab-b");
    hubA.setSink("tab-a", sinkRecorder().sink);
    hubB.setSink("tab-b", sinkB.sink);
    hubA.attachHost(hostA);
    hubB.attachHost(hostB);
    const rosterWrite = [
      { id: "peer-a", user: "alice", access: "write" as const },
      { id: "peer-b", user: "bob", access: "write" as const },
    ];
    hubA.setRoom("tab-a", room("peer-a", rosterWrite));
    hubB.setRoom("tab-b", room("peer-b", rosterWrite));
    net.link("A", "B", true);
    await settle();

    hubB.setRoom(
      "tab-b",
      room("peer-b", [
        { id: "peer-a", user: "alice", access: "read" },
        { id: "peer-b", user: "bob", access: "write" },
      ]),
    );
    expect(hubA.send(ROOM, "peer-b", { ping: 1 })).toBe(true);
    await settle();
    expect(sinkB.messages.at(-1)).toEqual({ from: "peer-a", msg: { ping: 1 }, access: "read" });
  });

  it("an accept naming another user's peer is rejected", async () => {
    const net = new FakeLinkNet();
    const hostA = net.add("A", "alice");
    const hostB = net.add("B", "bob");
    net.add("C", "carol");
    const { hub: hubA, log } = makeHub();
    hubA.setLocalOwner("tab-a");
    hubA.setSink("tab-a", sinkRecorder().sink);
    hubA.attachHost(hostA);
    hubA.setRoom(
      "tab-a",
      room("peer-a", [
        { id: "peer-a", user: "alice", access: "write" },
        { id: "peer-b", user: "bob", access: "write" },
        { id: "peer-c", user: "carol", access: "write" },
      ]),
    );
    // Answer A's hello from B's channel end with C's peer id (B's hub never answers).
    hostB.onIncomingChannel((_peer, channel) => {
      channel.onmessage = (event) => {
        const text = typeof event.data === "string" ? event.data : "";
        let frame: { t?: string };
        try {
          frame = JSON.parse(text) as { t?: string };
        } catch {
          return;
        }
        if (frame.t === "hello") {
          channel.send(JSON.stringify({ t: "accept", peer: "peer-c" }));
        }
      };
    });
    net.link("A", "B", true);
    await settle();

    expect(hubA.peerStates(ROOM).get("peer-c")?.out).toBeFalsy();
    expect(hubA.peerStates(ROOM).get("peer-b")?.out).toBe(false);
    expect(log.mock.calls.some((call) => call[0] === "chan-accept-mismatch")).toBe(true);
  });

  it("a ready channel is closed when the roster later shows another owner", async () => {
    const net = new FakeLinkNet();
    const hostA = net.add("A", "alice");
    const hostB = net.add("B", "bob");
    const { hub: hubA, log } = makeHub();
    hubA.setLocalOwner("tab-a");
    hubA.setSink("tab-a", sinkRecorder().sink);
    hubA.attachHost(hostA);
    hubA.setRoom(
      "tab-a",
      room("peer-a", [
        { id: "peer-a", user: "alice", access: "write" },
        { id: "peer-b", user: "bob", access: "write" },
      ]),
    );
    hostB.onIncomingChannel((_peer, channel) => {
      channel.onmessage = (event) => {
        const text = typeof event.data === "string" ? event.data : "";
        let frame: { t?: string };
        try {
          frame = JSON.parse(text) as { t?: string };
        } catch {
          return;
        }
        if (frame.t === "hello") {
          // Unknown id on A's roster yet — accepted, then revalidated later.
          channel.send(JSON.stringify({ t: "accept", peer: "peer-x" }));
        }
      };
    });
    net.link("A", "B", true);
    await settle();
    expect(hubA.peerStates(ROOM).get("peer-x")).toEqual({ out: true, in: false });

    hubA.setRoom(
      "tab-a",
      room("peer-a", [
        { id: "peer-a", user: "alice", access: "write" },
        { id: "peer-b", user: "bob", access: "write" },
        { id: "peer-x", user: "carol", access: "write" },
      ]),
    );
    await settle();
    expect(hubA.peerStates(ROOM).get("peer-x")?.out).toBe(false);
    expect(log.mock.calls.some((call) => call[0] === "chan-accept-mismatch")).toBe(true);
  });
});
