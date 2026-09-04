/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyPrincipalTabPresenceMessage,
  electStickyLeaderTabId,
  isPrincipalTabStale,
  PRINCIPAL_ELECTION_GRACE_MS,
  PRINCIPAL_TAB_CHANNEL,
  PrincipalTabCoordinator,
  pruneStalePrincipalTabs,
  resolvePrincipalLeaderClaim,
  shouldResignPrincipalOnHide,
  type PrincipalTabPresence,
} from "./principal-tab-sync";

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

function tab(tabId: string, visible: boolean, lastSeen: number): PrincipalTabPresence {
  return { tabId, visible, lastSeen };
}

function handlers() {
  return {
    onBecomeLeader: vi.fn(),
    onResignLeader: vi.fn(),
    onEnvelopeFromFollower: vi.fn(),
    onEnvelopeFromLeader: vi.fn(),
    onRosterFromLeader: vi.fn(),
  };
}

function advanceElectionGrace(): void {
  vi.advanceTimersByTime(PRINCIPAL_ELECTION_GRACE_MS);
}

describe("principal-tab-sync sticky election", () => {
  const now = 1_000_000;

  it("keeps the current leader even when hidden and another tab is visible", () => {
    const tabs = new Map<string, PrincipalTabPresence>([
      ["tab-a", tab("tab-a", false, now)],
      ["tab-b", tab("tab-b", true, now)],
    ]);
    expect(electStickyLeaderTabId(tabs, "tab-a", now)).toBe("tab-a");
  });

  it("elects the lowest tab id on cold start", () => {
    const tabs = new Map<string, PrincipalTabPresence>([
      ["tab-b", tab("tab-b", true, now)],
      ["tab-a", tab("tab-a", true, now)],
    ]);
    expect(electStickyLeaderTabId(tabs, null, now)).toBe("tab-a");
  });

  it("takes over when the sticky leader goes stale", () => {
    const tabs = new Map<string, PrincipalTabPresence>([
      ["tab-a", tab("tab-a", true, now - 10_000)],
      ["tab-b", tab("tab-b", true, now)],
    ]);
    expect(electStickyLeaderTabId(tabs, "tab-a", now)).toBe("tab-b");
    expect(isPrincipalTabStale(now - 10_000, now)).toBe(true);
    expect(pruneStalePrincipalTabs(tabs, now).size).toBe(1);
  });

  it("never resigns on visibility hide", () => {
    expect(shouldResignPrincipalOnHide(true, false)).toBe(false);
    expect(shouldResignPrincipalOnHide(true, true)).toBe(false);
  });

  it("applies leave by removing the tab", () => {
    const tabs = new Map<string, PrincipalTabPresence>([["tab-a", tab("tab-a", true, now)]]);
    applyPrincipalTabPresenceMessage(tabs, { type: "tab-leave", tabId: "tab-a", at: now });
    expect(tabs.size).toBe(0);
  });

  it("adopts a remote leader claim and resolves split-brain by lex order", () => {
    expect(resolvePrincipalLeaderClaim("tab-b", false, null, "tab-a", true)).toBe("tab-a");
    expect(resolvePrincipalLeaderClaim("tab-b", true, "tab-b", "tab-a", true)).toBe("tab-a");
    expect(resolvePrincipalLeaderClaim("tab-a", true, "tab-a", "tab-b", true)).toBe("tab-a");
  });
});

describe("PrincipalTabCoordinator", () => {
  beforeEach(() => {
    MockBroadcastChannel.peers = [];
    Reflect.deleteProperty(globalThis, "BroadcastChannel");
    vi.stubGlobal("BroadcastChannel", MockBroadcastChannel);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    MockBroadcastChannel.peers = [];
  });

  it("elects a single sticky leader across two tabs", () => {
    const a = handlers();
    const b = handlers();
    const leaderA = new PrincipalTabCoordinator(a, "tab-a");
    const leaderB = new PrincipalTabCoordinator(b, "tab-b");
    leaderA.start();
    leaderB.start();
    advanceElectionGrace();

    expect(leaderA.meshLeader).toBe(true);
    expect(leaderB.meshLeader).toBe(false);
    expect(a.onBecomeLeader).toHaveBeenCalledTimes(1);
    expect(b.onBecomeLeader).not.toHaveBeenCalled();
  });

  it("keeps leadership when the leader tab becomes hidden", () => {
    const a = handlers();
    const b = handlers();
    const leaderA = new PrincipalTabCoordinator(a, "tab-a");
    const leaderB = new PrincipalTabCoordinator(b, "tab-b");
    leaderA.start();
    leaderB.start();
    advanceElectionGrace();

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(leaderA.meshLeader).toBe(true);
    expect(a.onResignLeader).not.toHaveBeenCalled();
    expect(b.onBecomeLeader).not.toHaveBeenCalled();
  });

  it("hands off when the leader closes (pagehide/stop path)", () => {
    // Each real window has its own `window`; jsdom is shared, so simulate
    // leader close via stop() rather than dispatching a global pagehide.
    const a = handlers();
    const b = handlers();
    const leaderA = new PrincipalTabCoordinator(a, "tab-a");
    const leaderB = new PrincipalTabCoordinator(b, "tab-b");
    leaderA.start();
    leaderB.start();
    advanceElectionGrace();

    leaderA.stop();

    expect(leaderA.meshLeader).toBe(false);
    expect(leaderB.meshLeader).toBe(true);
    expect(b.onBecomeLeader).toHaveBeenCalledTimes(1);
  });

  it("proxies follower envelope-out to the leader handler", () => {
    const a = handlers();
    const b = handlers();
    const leaderA = new PrincipalTabCoordinator(a, "tab-a");
    const leaderB = new PrincipalTabCoordinator(b, "tab-b");
    leaderA.start();
    leaderB.start();
    advanceElectionGrace();

    const envelope = { v: 1 as const, kind: "typing" as const };
    leaderB.publishEnvelopeOut(envelope);

    expect(a.onEnvelopeFromFollower).toHaveBeenCalledWith({
      fromTab: "tab-b",
      envelope,
      peerId: undefined,
    });
    expect(b.onEnvelopeFromFollower).not.toHaveBeenCalled();
  });

  it("proxies leader envelope-in and roster to followers", () => {
    const a = handlers();
    const b = handlers();
    const leaderA = new PrincipalTabCoordinator(a, "tab-a");
    const leaderB = new PrincipalTabCoordinator(b, "tab-b");
    leaderA.start();
    leaderB.start();
    advanceElectionGrace();

    const envelope = { v: 1 as const, kind: "presence" as const, status: "online" as const };
    leaderA.publishEnvelopeIn("peer-1", envelope);
    leaderA.publishRosterState({
      peers: [{ id: "peer-1", name: "Bob", user: "bob" }],
      selfPeerId: "peer-self",
    });

    expect(b.onEnvelopeFromLeader).toHaveBeenCalledWith({ peerId: "peer-1", envelope });
    expect(b.onRosterFromLeader).toHaveBeenCalledWith({
      peers: [{ id: "peer-1", name: "Bob", user: "bob" }],
      selfPeerId: "peer-self",
    });
    expect(a.onEnvelopeFromLeader).not.toHaveBeenCalled();
  });

  it("exports the expected channel name", () => {
    expect(PRINCIPAL_TAB_CHANNEL).toBe("wgw.principal.tab");
  });
});

describe("PrincipalTabCoordinator async BroadcastChannel", () => {
  beforeEach(() => {
    DeferredBroadcastChannel.peers = [];
    DeferredBroadcastChannel.queue = [];
    Reflect.deleteProperty(globalThis, "BroadcastChannel");
    vi.stubGlobal("BroadcastChannel", DeferredBroadcastChannel);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    DeferredBroadcastChannel.peers = [];
    DeferredBroadcastChannel.queue = [];
  });

  it("second tab does not become leader when existing leader pings arrive before grace ends", () => {
    const a = handlers();
    const b = handlers();
    const leaderA = new PrincipalTabCoordinator(a, "tab-a");
    const leaderB = new PrincipalTabCoordinator(b, "tab-b");

    leaderA.start();
    DeferredBroadcastChannel.flush();
    advanceElectionGrace();
    DeferredBroadcastChannel.flush();
    expect(leaderA.meshLeader).toBe(true);

    leaderB.start();
    // Deliver A's isLeader ping (and discovery replies) while B is still in grace.
    DeferredBroadcastChannel.flush();
    advanceElectionGrace();
    DeferredBroadcastChannel.flush();

    expect(leaderA.meshLeader).toBe(true);
    expect(leaderB.meshLeader).toBe(false);
    expect(b.onBecomeLeader).not.toHaveBeenCalled();
  });

  it("resolves split-brain when delayed delivery lets both tabs claim leadership", () => {
    const a = handlers();
    const b = handlers();
    const leaderA = new PrincipalTabCoordinator(a, "tab-a");
    const leaderB = new PrincipalTabCoordinator(b, "tab-b");

    leaderA.start();
    advanceElectionGrace();
    // No flush yet — A elected in isolation.
    expect(leaderA.meshLeader).toBe(true);

    leaderB.start();
    advanceElectionGrace();
    // Still isolated — classic live bug before isLeader reconciliation.
    expect(leaderB.meshLeader).toBe(true);

    DeferredBroadcastChannel.flush();

    expect(leaderA.meshLeader).toBe(true);
    expect(leaderB.meshLeader).toBe(false);
    expect(b.onResignLeader).toHaveBeenCalled();
  });
});
