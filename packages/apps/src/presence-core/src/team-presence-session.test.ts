/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import type { RtcPeerDescriptor } from "@/lib/rtc/types";
import { FollowerPresenceSession } from "@/presence-core/src/follower-presence-session";
import { createPresenceStore } from "@/presence-core/src/presence-store";
import type { PresenceEnvelope, PresenceMeshEvent } from "@/presence-core/src/presence-types";
import {
  TeamPresenceSession,
  type TeamRoomSession,
} from "@/presence-core/src/team-presence-session";

class FakeRoom implements TeamRoomSession {
  peers: RtcPeerDescriptor[] = [];

  linked = new Set<string>();

  broadcasts: PresenceEnvelope[] = [];

  sentTo: Array<{ peerId: string; envelope: PresenceEnvelope }> = [];

  joinedAs: string | null = null;

  leaveCalls = 0;

  steadyScale = 1;

  failJoin = false;

  private readonly listeners = new Set<(event: PresenceMeshEvent) => void>();

  constructor(
    readonly room: string,
    private readonly selfPeerId: string,
  ) {}

  async join(name: string): Promise<{ peerId: string }> {
    if (this.failJoin) throw new Error("forbidden");
    this.joinedAs = name;
    return { peerId: this.selfPeerId };
  }

  async leave(): Promise<void> {
    this.leaveCalls += 1;
  }

  broadcast(envelope: PresenceEnvelope): void {
    this.broadcasts.push(envelope);
  }

  sendTo(peerId: string, envelope: PresenceEnvelope): void {
    this.sentTo.push({ peerId, envelope });
  }

  getRoomPeers(): RtcPeerDescriptor[] {
    return this.peers;
  }

  isLinked(peerId: string): boolean {
    return this.linked.has(peerId);
  }

  onEvent(listener: (event: PresenceMeshEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  ownPeers(): { room: string; peerId: string }[] {
    return this.joinedAs === null ? [] : [{ room: this.room, peerId: this.selfPeerId }];
  }

  setSteadyScale(scale: number): void {
    this.steadyScale = scale;
  }

  emit(event: PresenceMeshEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

function setup() {
  const rooms = new Map<string, FakeRoom>();
  const removed: string[] = [];
  const session = new TeamPresenceSession({
    createRoomSession: (room) => {
      const fake = new FakeRoom(room, `me-${room}`);
      rooms.set(room, fake);
      return fake;
    },
    onRoomRemoved: (room) => removed.push(room),
  });
  return { session, rooms, removed };
}

const peer = (id: string, user: string, name = user): RtcPeerDescriptor => ({ id, user, name });

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("TeamPresenceSession", () => {
  it("joins one room per Team and lists the peers of every room", async () => {
    const { session, rooms } = setup();
    session.setRooms(["groups.design", "groups.sales"]);

    await expect(session.join("Alice")).resolves.toEqual({ peerId: "me-groups.design" });
    expect(rooms.get("groups.design")?.joinedAs).toBe("Alice");
    expect(rooms.get("groups.sales")?.joinedAs).toBe("Alice");

    rooms.get("groups.design")!.peers = [peer("bob-1", "bob")];
    rooms.get("groups.sales")!.peers = [peer("carol-1", "carol")];
    expect(session.getRoomPeers().map((p) => p.id)).toEqual(["bob-1", "carol-1"]);
    expect(session.ownPeers()).toEqual([
      { room: "groups.design", peerId: "me-groups.design" },
      { room: "groups.sales", peerId: "me-groups.sales" },
    ]);
  });

  it("routes a targeted send and the link state to the room that has the peer", async () => {
    const { session, rooms } = setup();
    session.setRooms(["groups.design", "groups.sales"]);
    await session.join("Alice");
    rooms.get("groups.sales")!.peers = [peer("carol-1", "carol")];
    rooms.get("groups.sales")!.linked.add("carol-1");

    session.sendTo("carol-1", { v: 1, kind: "check-now" });
    expect(rooms.get("groups.sales")?.sentTo).toEqual([
      { peerId: "carol-1", envelope: { v: 1, kind: "check-now" } },
    ]);
    expect(rooms.get("groups.design")?.sentTo).toEqual([]);
    expect(session.isLinked("carol-1")).toBe(true);
    expect(session.isLinked("nobody-1")).toBe(false);

    session.broadcast({ v: 1, kind: "typing" });
    expect(rooms.get("groups.design")?.broadcasts).toHaveLength(1);
    expect(rooms.get("groups.sales")?.broadcasts).toHaveLength(1);
  });

  it("sends a targeted envelope to one room per remote user, one copy per tab", async () => {
    const { session, rooms } = setup();
    session.setRooms(["groups.engineering", "groups.team"]);
    await session.join("Alice");
    rooms.get("groups.engineering")!.peers = [peer("bob-eng-1", "bob"), peer("bob-eng-2", "bob")];
    rooms.get("groups.team")!.peers = [peer("bob-team-1", "bob"), peer("bob-team-2", "bob")];
    expect(session.peersForUsername("Bob").map((p) => p.id)).toEqual(["bob-eng-1", "bob-eng-2"]);

    expect(session.peersForUsername("carol")).toEqual([]);

    rooms.get("groups.engineering")!.peers = [];
    expect(session.peersForUsername("bob").map((p) => p.id)).toEqual(["bob-team-1", "bob-team-2"]);
  });

  it("prefers the room where the user's channel is open", async () => {
    const { session, rooms } = setup();
    session.setRooms(["groups.engineering", "groups.team"]);
    await session.join("Alice");
    rooms.get("groups.engineering")!.peers = [peer("bob-eng", "bob")];
    rooms.get("groups.team")!.peers = [peer("bob-team", "bob")];
    rooms.get("groups.team")!.linked.add("bob-team");
    expect(session.peersForUsername("bob").map((p) => p.id)).toEqual(["bob-team"]);

    rooms.get("groups.team")!.linked.clear();
    expect(session.peersForUsername("bob").map((p) => p.id)).toEqual(["bob-eng"]);
  });

  it("a follower window sends a targeted envelope once, to the peers the leader chose", async () => {
    const out: Array<{ envelope: PresenceEnvelope; peerId?: string }> = [];
    const follower = new FollowerPresenceSession((envelope, peerId) =>
      out.push({ envelope, peerId }),
    );
    follower.applyRoster({
      peers: [peer("bob-eng", "bob"), peer("bob-team", "bob")],
      selfPeerId: null,
      linkedPeerIds: ["bob-team"],
      targetPeerIds: { bob: ["bob-team"] },
    });
    const store = createPresenceStore({
      createSession: () => follower,
      joinMode: "eager",
      visibility: null,
    });
    store.start({ username: "alice", displayName: "Alice" });
    await vi.waitFor(() => expect(store.getSnapshot().status).toBe("online"));
    store.sendToUsernames(["bob"], { v: 1, kind: "check-now" });
    expect(out.map((row) => row.peerId)).toEqual(["bob-team"]);
  });

  it("sendToUsernames reaches a tab once although it shares two Teams", async () => {
    const { session, rooms } = setup();
    session.setRooms(["groups.engineering", "groups.team"]);
    const store = createPresenceStore({
      createSession: () => session,
      joinMode: "eager",
      visibility: null,
    });
    store.start({ username: "alice", displayName: "Alice" });
    await vi.waitFor(() => expect(store.getSnapshot().status).toBe("online"));
    rooms.get("groups.engineering")!.peers = [peer("bob-eng", "bob")];
    rooms.get("groups.team")!.peers = [peer("bob-team", "bob")];

    store.sendToUsernames(["bob"], { v: 1, kind: "check-now" });
    expect(rooms.get("groups.engineering")?.sentTo.map((row) => row.peerId)).toEqual(["bob-eng"]);
    expect(rooms.get("groups.team")?.sentTo).toEqual([]);
    await store.stop();
  });

  it("joins a Team added later and leaves a Team that is gone", async () => {
    const { session, rooms, removed } = setup();
    const events: PresenceMeshEvent[] = [];
    session.onEvent((event) => events.push(event));
    session.setRooms(["groups.design"]);
    await session.join("Alice");

    session.setRooms(["groups.sales"]);
    await settle();

    expect(rooms.get("groups.sales")?.joinedAs).toBe("Alice");
    expect(rooms.get("groups.design")?.leaveCalls).toBe(1);
    expect(removed).toEqual(["groups.design"]);
    expect(session.roomNames()).toEqual(["groups.sales"]);
    expect(events).toContainEqual({ type: "roster" });
  });

  it("drops a room that refused the join, so the next Team check adds it again", async () => {
    const { session, rooms } = setup();
    session.setRooms(["groups.design", "groups.sales"]);
    rooms.get("groups.sales")!.failJoin = true;

    await expect(session.join("Alice")).resolves.toEqual({ peerId: "me-groups.design" });
    await settle();
    expect(session.roomNames()).toEqual(["groups.design"]);

    session.setRooms(["groups.design", "groups.sales"]);
    expect(session.roomNames()).toEqual(["groups.design", "groups.sales"]);
  });

  it("fails the join only when every room refuses", async () => {
    const { session, rooms } = setup();
    session.setRooms(["groups.design"]);
    rooms.get("groups.design")!.failJoin = true;

    await expect(session.join("Alice")).rejects.toThrow("forbidden");
  });

  it("is joined with no peers when the user is in no Team", async () => {
    const { session } = setup();
    session.setRooms([]);

    await expect(session.join("Alice")).resolves.toEqual({ peerId: "" });
    expect(session.getRoomPeers()).toEqual([]);
  });

  it("stretches the slow polls so all rooms poll at most twice one room", () => {
    const { session, rooms } = setup();
    session.setRooms(["groups.a"]);
    expect(rooms.get("groups.a")?.steadyScale).toBe(1);

    session.setRooms(["groups.a", "groups.b"]);
    expect(rooms.get("groups.a")?.steadyScale).toBe(1);

    session.setRooms(["groups.a", "groups.b", "groups.c", "groups.d"]);
    for (const room of rooms.values()) expect(room.steadyScale).toBe(2);
  });

  it("leaves every room and ignores later Team lists once left", async () => {
    const { session, rooms, removed } = setup();
    session.setRooms(["groups.design", "groups.sales"]);
    await session.join("Alice");

    await session.leave();
    session.setRooms(["groups.other"]);

    expect(rooms.get("groups.design")?.leaveCalls).toBe(1);
    expect(rooms.get("groups.sales")?.leaveCalls).toBe(1);
    expect(removed.sort()).toEqual(["groups.design", "groups.sales"]);
    expect(rooms.has("groups.other")).toBe(false);
  });
});

describe("presence roster over Team rooms", () => {
  it("merges the rosters by username and lists only people from own Teams", async () => {
    const { session, rooms } = setup();
    session.setRooms(["groups.design", "groups.sales"]);
    const store = createPresenceStore({
      createSession: () => session,
      joinMode: "eager",
      visibility: null,
    });
    store.start({ username: "alice", displayName: "Alice" });
    await vi.waitFor(() => expect(store.getSnapshot().status).toBe("online"));

    // Bob shares both Teams (one peer per room, same tab); Carol only Sales.
    rooms.get("groups.design")!.peers = [
      peer("bob-1", "bob", "Bob"),
      peer("me-groups.design", "alice"),
    ];
    rooms.get("groups.sales")!.peers = [
      peer("bob-2", "bob", "Bob"),
      peer("carol-1", "carol", "Carol"),
    ];
    rooms.get("groups.sales")!.emit({ type: "roster" });

    expect(store.getSnapshot().roster).toEqual([
      { username: "bob", name: "Bob", status: "online" },
      { username: "carol", name: "Carol", status: "online" },
    ]);

    // Bob is away only when every one of his peers says so.
    rooms.get("groups.design")!.emit({
      type: "envelope",
      peerId: "bob-1",
      envelope: { v: 1, kind: "presence", status: "away" },
    });
    expect(store.getSnapshot().roster[0]).toMatchObject({ username: "bob", status: "online" });
    rooms.get("groups.sales")!.emit({
      type: "envelope",
      peerId: "bob-2",
      envelope: { v: 1, kind: "presence", status: "away" },
    });
    expect(store.getSnapshot().roster[0]).toMatchObject({ username: "bob", status: "away" });

    // Leaving Sales: Carol goes, Bob stays through Design.
    session.setRooms(["groups.design"]);
    expect(store.getSnapshot().roster.map((coworker) => coworker.username)).toEqual(["bob"]);

    await store.stop();
  });
});
