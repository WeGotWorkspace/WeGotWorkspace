/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyPrincipalTabPresenceMessage,
  electStickyLeaderTabId,
  isPrincipalTabStale,
  PRINCIPAL_TAB_CHANNEL,
  PrincipalTabCoordinator,
  pruneStalePrincipalTabs,
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
});

describe("PrincipalTabCoordinator", () => {
  beforeEach(() => {
    MockBroadcastChannel.peers = [];
    Reflect.deleteProperty(globalThis, "BroadcastChannel");
    vi.stubGlobal("BroadcastChannel", MockBroadcastChannel);
  });

  afterEach(() => {
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

    leaderA.stop();

    expect(a.onResignLeader).not.toHaveBeenCalled(); // stop resigns via BC without onResignLeader when already posting leave
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
