/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getPrincipalLinkRegistry,
  resetPrincipalLinkRegistryForTests,
} from "@/lib/rtc/session/principal-link-registry";
import type { RtcPeerDescriptor } from "@/lib/rtc/types";
import {
  createPresenceStore,
  type PresenceVisibilityPort,
} from "@/presence-core/src/presence-store";
import type {
  PresenceEnvelope,
  PresenceMeshEvent,
  PresenceMeshSession,
} from "@/presence-core/src/presence-types";
import {
  PRINCIPAL_ELECTION_GRACE_MS,
  PrincipalTabCoordinator,
} from "@/presence-core/src/principal-tab-sync";

class MockBroadcastChannel {
  static peers: MockBroadcastChannel[] = [];

  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(_name: string) {
    MockBroadcastChannel.peers.push(this);
  }

  postMessage(data: unknown): void {
    for (const peer of MockBroadcastChannel.peers) {
      if (peer !== this) peer.onmessage?.({ data } as MessageEvent);
    }
  }

  close(): void {
    const index = MockBroadcastChannel.peers.indexOf(this);
    if (index >= 0) MockBroadcastChannel.peers.splice(index, 1);
  }
}

/** Queues posts until `flush()` — models async BroadcastChannel delivery. */
class DeferredBroadcastChannel {
  static peers: DeferredBroadcastChannel[] = [];

  static queue: Array<{ from: DeferredBroadcastChannel; data: unknown }> = [];

  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(_name: string) {
    DeferredBroadcastChannel.peers.push(this);
  }

  postMessage(data: unknown): void {
    DeferredBroadcastChannel.queue.push({ from: this, data });
  }

  close(): void {
    const index = DeferredBroadcastChannel.peers.indexOf(this);
    if (index >= 0) DeferredBroadcastChannel.peers.splice(index, 1);
  }

  static flush(): void {
    // Drain nested replies (e.g. discovery `sendPing`) like a burst of BC tasks.
    while (DeferredBroadcastChannel.queue.length > 0) {
      const batch = DeferredBroadcastChannel.queue.splice(0);
      for (const { from, data } of batch) {
        for (const peer of DeferredBroadcastChannel.peers) {
          if (peer !== from) peer.onmessage?.({ data } as MessageEvent);
        }
      }
    }
  }
}

class FakeSession implements PresenceMeshSession {
  peers: RtcPeerDescriptor[] = [];

  broadcasts: PresenceEnvelope[] = [];

  sentTo: Array<{ peerId: string; envelope: PresenceEnvelope }> = [];

  joinCalls = 0;

  leaveCalls = 0;

  failJoin = false;

  private readonly listeners = new Set<(event: PresenceMeshEvent) => void>();

  async join(): Promise<{ peerId: string }> {
    this.joinCalls += 1;
    if (this.failJoin) throw new Error("join failed");
    return { peerId: "alice-abc123" };
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

  onEvent(listener: (event: PresenceMeshEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: PresenceMeshEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

class FakeVisibility implements PresenceVisibilityPort {
  state: DocumentVisibilityState = "visible";

  private readonly listeners = new Set<() => void>();

  getState = (): DocumentVisibilityState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  setState(state: DocumentVisibilityState): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

type SetupOptions = {
  joinMode?: "eager" | "lazy";
  visibility?: FakeVisibility | null;
  now?: () => number;
  typingTtlMs?: number;
};

function setup(options: SetupOptions = {}) {
  const session = new FakeSession();
  const store = createPresenceStore({
    createSession: () => session,
    joinMode: options.joinMode ?? "eager",
    visibility: options.visibility ?? null,
    now: options.now,
    typingTtlMs: options.typingTtlMs,
  });
  return { session, store };
}

const SELF = { username: "alice", displayName: "Alice" };

describe("PresenceStore join timing", () => {
  it("joins eagerly on start in eager mode", async () => {
    resetPrincipalLinkRegistryForTests();
    const { session, store } = setup({ joinMode: "eager" });
    store.start(SELF);
    expect(store.getSnapshot().status).toBe("joining");
    await flushMicrotasks();
    expect(session.joinCalls).toBe(1);
    expect(store.getSnapshot().status).toBe("online");
    expect(store.getSnapshot().selfUsername).toBe("alice");
    expect(getPrincipalLinkRegistry().hasPrincipalJoinAttempted()).toBe(true);
  });

  it("defers the join until the tab becomes visible in lazy mode", async () => {
    const visibility = new FakeVisibility();
    visibility.state = "hidden";
    const { session, store } = setup({ joinMode: "lazy", visibility });

    store.start(SELF);
    await flushMicrotasks();
    expect(session.joinCalls).toBe(0);
    expect(store.getSnapshot().status).toBe("waiting");

    visibility.setState("visible");
    await flushMicrotasks();
    expect(session.joinCalls).toBe(1);
    expect(store.getSnapshot().status).toBe("online");
  });

  it("joins immediately in lazy mode when the tab is already visible", async () => {
    const visibility = new FakeVisibility();
    const { session, store } = setup({ joinMode: "lazy", visibility });
    store.start(SELF);
    await flushMicrotasks();
    expect(session.joinCalls).toBe(1);
  });

  it("retries a failed lazy join on the next resume", async () => {
    const visibility = new FakeVisibility();
    visibility.state = "hidden";
    const { session, store } = setup({ joinMode: "lazy", visibility });
    session.failJoin = true;

    store.start(SELF);
    visibility.setState("visible");
    await flushMicrotasks();
    expect(session.joinCalls).toBe(1);
    expect(store.getSnapshot().status).toBe("waiting");

    session.failJoin = false;
    visibility.setState("hidden");
    visibility.setState("visible");
    await flushMicrotasks();
    expect(session.joinCalls).toBe(2);
    expect(store.getSnapshot().status).toBe("online");
  });

  it("marks an eager join failure as error", async () => {
    const { session, store } = setup({ joinMode: "eager" });
    session.failJoin = true;
    store.start(SELF);
    await flushMicrotasks();
    expect(store.getSnapshot().status).toBe("error");
  });
});

describe("PresenceStore roster", () => {
  it("builds the coworker roster from mesh roster events, keyed on username", async () => {
    const { session, store } = setup();
    store.start(SELF);
    await flushMicrotasks();

    session.peers = [
      { id: "bob-aaa111", name: "Bob", user: "bob" },
      { id: "carol-bbb222", name: "Carol", user: "carol" },
    ];
    session.emit({ type: "roster" });

    expect(store.getSnapshot().roster).toEqual([
      { username: "bob", name: "Bob", status: "online" },
      { username: "carol", name: "Carol", status: "online" },
    ]);
  });

  it("excludes self and merges multi-tab sessions of the same user", async () => {
    const { session, store } = setup();
    store.start(SELF);
    await flushMicrotasks();

    session.peers = [
      { id: "alice-tab222", name: "Alice", user: "alice" },
      { id: "bob-aaa111", name: "Bob", user: "bob" },
      { id: "bob-ccc333", name: "Bob", user: "bob" },
    ];
    session.emit({ type: "roster" });

    expect(store.getSnapshot().roster).toEqual([
      { username: "bob", name: "Bob", status: "online" },
    ]);
  });

  it("reports away only when every session of a user is away", async () => {
    const { session, store } = setup();
    store.start(SELF);
    await flushMicrotasks();

    session.peers = [
      { id: "bob-aaa111", name: "Bob", user: "bob" },
      { id: "bob-ccc333", name: "Bob", user: "bob" },
    ];
    session.emit({ type: "roster" });
    session.emit({
      type: "envelope",
      peerId: "bob-aaa111",
      envelope: { v: 1, kind: "presence", status: "away" },
    });
    expect(store.getSnapshot().roster[0]?.status).toBe("online");

    session.emit({
      type: "envelope",
      peerId: "bob-ccc333",
      envelope: { v: 1, kind: "presence", status: "away" },
    });
    expect(store.getSnapshot().roster[0]?.status).toBe("away");
  });

  it("discloses own status to a newly linked peer", async () => {
    const { session, store } = setup();
    store.start(SELF);
    await flushMicrotasks();

    store.setAway(true);
    session.emit({ type: "dc-open", peerId: "bob-aaa111" });

    expect(session.sentTo).toEqual([
      { peerId: "bob-aaa111", envelope: { v: 1, kind: "presence", status: "away" } },
    ]);
  });
});

describe("PresenceStore envelope routing", () => {
  async function online() {
    const now = { value: 1000 };
    const result = setup({ now: () => now.value, typingTtlMs: 100 });
    result.store.start(SELF);
    await flushMicrotasks();
    result.session.peers = [{ id: "bob-aaa111", name: "Bob", user: "bob" }];
    result.session.emit({ type: "roster" });
    return { ...result, now };
  }

  it("routes chat envelopes into the chat log with the roster identity", async () => {
    const { session, store } = await online();

    session.emit({
      type: "envelope",
      peerId: "bob-aaa111",
      envelope: { v: 1, kind: "chat", id: "bob:1", body: "hello", ts: 42 },
    });

    expect(store.getSnapshot().chat).toEqual([
      { id: "bob:1", fromUsername: "bob", fromName: "Bob", body: "hello", ts: 42, isSelf: false },
    ]);
  });

  it("ignores duplicate chat envelopes by id", async () => {
    const { session, store } = await online();
    const envelope = { v: 1, kind: "chat", id: "bob:1", body: "hello", ts: 42 } as const;
    session.emit({ type: "envelope", peerId: "bob-aaa111", envelope });
    session.emit({ type: "envelope", peerId: "bob-aaa111", envelope });
    expect(store.getSnapshot().chat).toHaveLength(1);
  });

  it("tracks typing indicators and clears them on chat arrival", async () => {
    const { session, store } = await online();

    session.emit({
      type: "envelope",
      peerId: "bob-aaa111",
      envelope: { v: 1, kind: "typing" },
    });
    expect(store.getSnapshot().typingUsernames).toEqual(["bob"]);

    session.emit({
      type: "envelope",
      peerId: "bob-aaa111",
      envelope: { v: 1, kind: "chat", id: "bob:2", body: "done", ts: 43 },
    });
    expect(store.getSnapshot().typingUsernames).toEqual([]);
  });

  it("expires typing indicators after the ttl", async () => {
    vi.useFakeTimers();
    try {
      const session = new FakeSession();
      let nowValue = 1000;
      const store = createPresenceStore({
        createSession: () => session,
        joinMode: "eager",
        visibility: null,
        now: () => nowValue,
        typingTtlMs: 100,
      });
      store.start(SELF);
      await vi.runAllTimersAsync();
      session.peers = [{ id: "bob-aaa111", name: "Bob", user: "bob" }];
      session.emit({ type: "roster" });

      session.emit({ type: "envelope", peerId: "bob-aaa111", envelope: { v: 1, kind: "typing" } });
      expect(store.getSnapshot().typingUsernames).toEqual(["bob"]);

      nowValue += 200;
      await vi.advanceTimersByTimeAsync(200);
      expect(store.getSnapshot().typingUsernames).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends chat as a broadcast envelope and appends it locally as self", async () => {
    const { session, store } = await online();

    store.sendChat("  hi all  ");

    expect(session.broadcasts).toContainEqual(
      expect.objectContaining({ v: 1, kind: "chat", body: "hi all" }),
    );
    const chat = store.getSnapshot().chat;
    expect(chat).toHaveLength(1);
    expect(chat[0]).toMatchObject({
      fromUsername: "alice",
      fromName: "Alice",
      body: "hi all",
      isSelf: true,
    });
  });

  it("broadcasts typing and away transitions", async () => {
    const { session, store } = await online();

    store.sendTyping();
    store.setAway(true);
    store.setAway(true); // no duplicate broadcast for unchanged status

    expect(session.broadcasts).toEqual([
      { v: 1, kind: "typing" },
      { v: 1, kind: "presence", status: "away" },
    ]);
  });

  it("does not send chat or typing before the join completed", () => {
    const visibility = new FakeVisibility();
    visibility.state = "hidden";
    const { session, store } = setup({ joinMode: "lazy", visibility });
    store.start(SELF);

    store.sendChat("hello");
    store.sendTyping();

    expect(session.broadcasts).toEqual([]);
    expect(store.getSnapshot().chat).toEqual([]);
  });
});

describe("PresenceStore lifecycle", () => {
  it("stop leaves the room and resets the snapshot", async () => {
    const { session, store } = setup();
    store.start(SELF);
    await flushMicrotasks();
    session.peers = [{ id: "bob-aaa111", name: "Bob", user: "bob" }];
    session.emit({ type: "roster" });

    await store.stop();

    expect(session.leaveCalls).toBe(1);
    expect(store.getSnapshot()).toMatchObject({ status: "idle", roster: [], chat: [] });
  });

  it("notifies subscribers on snapshot changes", async () => {
    const { session, store } = setup();
    const listener = vi.fn();
    store.subscribe(listener);

    store.start(SELF);
    await flushMicrotasks();
    listener.mockClear();

    session.peers = [{ id: "bob-aaa111", name: "Bob", user: "bob" }];
    session.emit({ type: "roster" });
    expect(listener).toHaveBeenCalled();
    expect(store.getSnapshot().roster).toHaveLength(1);
  });
});

describe("PresenceStore cross-window leadership", () => {
  beforeEach(() => {
    MockBroadcastChannel.peers = [];
    Reflect.deleteProperty(globalThis, "BroadcastChannel");
    vi.stubGlobal("BroadcastChannel", MockBroadcastChannel);
    resetPrincipalLinkRegistryForTests();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    MockBroadcastChannel.peers = [];
  });

  async function settle(): Promise<void> {
    // Grace timer + promise chains from onBecomeLeader → joinNow (avoid setTimeout(0)
    // flushMicrotasks, which deadlocks under fake timers).
    await vi.advanceTimersByTimeAsync(PRINCIPAL_ELECTION_GRACE_MS);
    await drain();
  }

  async function drain(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
  }

  function setupLeaderPair() {
    const sessions: FakeSession[] = [];
    const createSession = () => {
      const session = new FakeSession();
      sessions.push(session);
      return session;
    };
    const storeA = createPresenceStore({
      createSession,
      joinMode: "eager",
      visibility: null,
      crossWindowLeader: true,
      createTabCoordinator: (handlers) => new PrincipalTabCoordinator(handlers, "tab-a"),
    });
    const storeB = createPresenceStore({
      createSession,
      joinMode: "eager",
      visibility: null,
      crossWindowLeader: true,
      createTabCoordinator: (handlers) => new PrincipalTabCoordinator(handlers, "tab-b"),
    });
    return { storeA, storeB, sessions };
  }

  it("only the sticky leader dials the principal session", async () => {
    const { storeA, storeB, sessions } = setupLeaderPair();
    storeA.start(SELF);
    storeB.start(SELF);
    await settle();

    expect(storeA.meshLeader).toBe(true);
    expect(storeB.meshLeader).toBe(false);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.joinCalls).toBe(1);
    expect(storeA.getSnapshot().status).toBe("online");
    // Leader join relays an (empty) roster snapshot → follower goes online without dialing.
    expect(storeB.getSnapshot().status).toBe("online");
  });

  it("proxies follower chat through the leader mesh session", async () => {
    const { storeA, storeB, sessions } = setupLeaderPair();
    storeA.start(SELF);
    storeB.start(SELF);
    await settle();

    const leaderSession = sessions[0]!;
    leaderSession.peers = [{ id: "bob-aaa111", name: "Bob", user: "bob" }];
    leaderSession.emit({ type: "roster" });
    await drain();

    expect(storeB.getSnapshot().status).toBe("online");
    expect(storeB.getSnapshot().roster).toEqual([
      { username: "bob", name: "Bob", status: "online" },
    ]);

    storeB.sendChat("from follower");
    await drain();

    expect(
      leaderSession.broadcasts.some((e) => e.kind === "chat" && e.body === "from follower"),
    ).toBe(true);
    expect(storeB.getSnapshot().chat[0]).toMatchObject({
      body: "from follower",
      isSelf: true,
    });
  });

  it("hands off the dial to a follower when the leader stops", async () => {
    const { storeA, storeB, sessions } = setupLeaderPair();
    storeA.start(SELF);
    storeB.start(SELF);
    await settle();
    expect(sessions).toHaveLength(1);

    await storeA.stop();
    await settle();

    expect(storeB.meshLeader).toBe(true);
    expect(sessions).toHaveLength(2);
    expect(sessions[1]?.joinCalls).toBe(1);
    expect(storeB.getSnapshot().status).toBe("online");
  });

  it("keeps leadership when the leader tab is hidden", async () => {
    const visibility = new FakeVisibility();
    const sessions: FakeSession[] = [];
    const storeA = createPresenceStore({
      createSession: () => {
        const session = new FakeSession();
        sessions.push(session);
        return session;
      },
      joinMode: "eager",
      visibility,
      crossWindowLeader: true,
      createTabCoordinator: (handlers) => new PrincipalTabCoordinator(handlers, "tab-a"),
    });
    const storeB = createPresenceStore({
      createSession: () => new FakeSession(),
      joinMode: "eager",
      visibility: null,
      crossWindowLeader: true,
      createTabCoordinator: (handlers) => new PrincipalTabCoordinator(handlers, "tab-b"),
    });

    storeA.start(SELF);
    storeB.start(SELF);
    await settle();

    visibility.setState("hidden");
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await drain();

    expect(storeA.meshLeader).toBe(true);
    expect(storeB.meshLeader).toBe(false);
    expect(sessions).toHaveLength(1);
  });

  it("second tab does not join while leader is alive (async BC)", async () => {
    DeferredBroadcastChannel.peers = [];
    DeferredBroadcastChannel.queue = [];
    vi.stubGlobal("BroadcastChannel", DeferredBroadcastChannel);

    const sessions: FakeSession[] = [];
    const createSession = () => {
      const session = new FakeSession();
      sessions.push(session);
      return session;
    };
    const storeA = createPresenceStore({
      createSession,
      joinMode: "eager",
      visibility: null,
      crossWindowLeader: true,
      createTabCoordinator: (handlers) => new PrincipalTabCoordinator(handlers, "tab-a"),
    });
    const storeB = createPresenceStore({
      createSession,
      joinMode: "eager",
      visibility: null,
      crossWindowLeader: true,
      createTabCoordinator: (handlers) => new PrincipalTabCoordinator(handlers, "tab-b"),
    });

    storeA.start(SELF);
    DeferredBroadcastChannel.flush();
    await settle();
    DeferredBroadcastChannel.flush();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.joinCalls).toBe(1);

    storeB.start(SELF);
    // Existing leader's isLeader ping arrives during B's grace — B must not dial.
    DeferredBroadcastChannel.flush();
    await settle();
    DeferredBroadcastChannel.flush();
    await Promise.resolve();
    await Promise.resolve();

    expect(storeA.meshLeader).toBe(true);
    expect(storeB.meshLeader).toBe(false);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.joinCalls).toBe(1);
  });
});
