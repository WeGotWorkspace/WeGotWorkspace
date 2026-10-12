/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyTabPresenceMessage,
  BC_TAB_ORIGIN,
  DocsCollabTabCoordinator,
  electLeaderTabId,
  electStickyDocsLeaderTabId,
  isTabPresenceStale,
  meshMessageForTabRelay,
  pruneStaleTabs,
  resolveDocsLeaderClaim,
  routeTabSyncMessage,
  shouldResignOnHide,
  type TabPresence,
} from "./docs-collab-tab-sync";

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

function tab(tabId: string, visible: boolean, lastSeen: number): TabPresence {
  return { tabId, visible, lastSeen };
}

describe("docs-collab-tab-sync leader election", () => {
  const now = 1_000_000;

  it("elects the lowest visible tab id", () => {
    const tabs = new Map<string, TabPresence>([
      ["tab-b", tab("tab-b", true, now)],
      ["tab-a", tab("tab-a", true, now)],
    ]);
    expect(electLeaderTabId(tabs, now)).toBe("tab-a");
  });

  it("prefers visible tabs over hidden ones", () => {
    const tabs = new Map<string, TabPresence>([
      ["tab-a", tab("tab-a", false, now)],
      ["tab-b", tab("tab-b", true, now)],
    ]);
    expect(electLeaderTabId(tabs, now)).toBe("tab-b");
  });

  it("falls back to hidden tabs when none are visible", () => {
    const tabs = new Map<string, TabPresence>([
      ["tab-z", tab("tab-z", false, now)],
      ["tab-a", tab("tab-a", false, now)],
    ]);
    expect(electLeaderTabId(tabs, now)).toBe("tab-a");
  });

  it("drops stale tabs before electing", () => {
    const tabs = new Map<string, TabPresence>([
      ["tab-a", tab("tab-a", true, now - 10_000)],
      ["tab-b", tab("tab-b", true, now)],
    ]);
    expect(electLeaderTabId(tabs, now)).toBe("tab-b");
    expect(isTabPresenceStale(now - 10_000, now)).toBe(true);
    expect(pruneStaleTabs(tabs, now).size).toBe(1);
  });

  it("keeps leadership when the leader tab becomes hidden", () => {
    expect(shouldResignOnHide(true, false)).toBe(false);
    expect(shouldResignOnHide(false, false)).toBe(false);
  });

  it("keeps a hidden leader until it leaves", () => {
    const now = 1_000_000;
    const hiddenLeader: TabPresence = {
      tabId: "tab-a",
      visible: false,
      lastSeen: now,
    };
    const visibleFollower: TabPresence = {
      tabId: "tab-b",
      visible: true,
      lastSeen: now,
    };
    const tabs = new Map<string, TabPresence>([
      ["tab-a", hiddenLeader],
      ["tab-b", visibleFollower],
    ]);

    expect(electStickyDocsLeaderTabId(tabs, "tab-a", now)).toBe("tab-a");
    expect(electLeaderTabId(tabs, now)).toBe("tab-b");
    expect(electStickyDocsLeaderTabId(tabs, null, now)).toBe("tab-b");
  });

  it("adopts the lexicographically smaller leader claim", () => {
    expect(resolveDocsLeaderClaim("tab-b", false, "tab-b", "tab-a", true)).toBe("tab-a");
    expect(resolveDocsLeaderClaim("tab-a", true, "tab-a", "tab-b", true)).toBe("tab-a");
    expect(resolveDocsLeaderClaim("tab-b", false, null, "tab-a", false)).toBeNull();
  });
});

describe("docs-collab-tab-sync message routing", () => {
  it("routes sync and awareness from other tabs only", () => {
    const onSyncFromTab = vi.fn();
    const onAwarenessFromTab = vi.fn();
    const onMeshStateFromLeader = vi.fn();

    routeTabSyncMessage({ type: "sync", u: [1, 2], fromTab: "other" }, "self", {
      onSyncFromTab,
      onAwarenessFromTab,
      onMeshStateFromLeader,
    });
    routeTabSyncMessage({ type: "awareness", u: [3, 4], fromTab: "other" }, "self", {
      onSyncFromTab,
      onAwarenessFromTab,
      onMeshStateFromLeader,
    });
    routeTabSyncMessage({ type: "sync", u: [9], fromTab: "self" }, "self", {
      onSyncFromTab,
      onAwarenessFromTab,
      onMeshStateFromLeader,
    });

    expect(onSyncFromTab).toHaveBeenCalledOnce();
    expect(onSyncFromTab).toHaveBeenCalledWith([1, 2]);
    expect(onAwarenessFromTab).toHaveBeenCalledOnce();
    expect(onAwarenessFromTab).toHaveBeenCalledWith([3, 4]);
    expect(onMeshStateFromLeader).not.toHaveBeenCalled();
  });

  it("tracks tab presence from ping and leave messages", () => {
    const tabs = new Map<string, TabPresence>();
    applyTabPresenceMessage(tabs, {
      type: "tab-ping",
      tabId: "tab-a",
      visible: true,
      at: 100,
    });
    applyTabPresenceMessage(tabs, { type: "tab-leave", tabId: "tab-a", at: 200 });
    expect(tabs.size).toBe(0);
  });

  it("relays only sync and awareness mesh payloads", () => {
    expect(meshMessageForTabRelay({ type: "sync", u: [1] })).toEqual({ type: "sync", u: [1] });
    expect(meshMessageForTabRelay({ type: "awareness", u: [2] })).toEqual({
      type: "awareness",
      u: [2],
    });
    expect(meshMessageForTabRelay({ type: "link" })).toBeNull();
    expect(meshMessageForTabRelay({ type: "dc-open", from: "peer-a" })).toBeNull();
  });
});

describe("docs-collab-tab-sync coordinator", () => {
  beforeEach(() => {
    MockBroadcastChannel.peers = [];
    Reflect.deleteProperty(globalThis, "BroadcastChannel");
    vi.stubGlobal("BroadcastChannel", MockBroadcastChannel);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("promotes one leader and forwards sync between tabs", () => {
    const onBecomeLeaderA = vi.fn();
    const onBecomeLeaderB = vi.fn();
    const onSyncB = vi.fn();

    const tabA = new DocsCollabTabCoordinator(
      "docs/test.md",
      {
        onSyncFromTab: vi.fn(),
        onAwarenessFromTab: vi.fn(),
        onMeshStateFromLeader: vi.fn(),
        onBecomeLeader: onBecomeLeaderA,
        onResignLeader: vi.fn(),
      },
      "tab-a",
    );
    const tabB = new DocsCollabTabCoordinator(
      "docs/test.md",
      {
        onSyncFromTab: onSyncB,
        onAwarenessFromTab: vi.fn(),
        onMeshStateFromLeader: vi.fn(),
        onBecomeLeader: onBecomeLeaderB,
        onResignLeader: vi.fn(),
      },
      "tab-b",
    );

    tabA.start();
    tabB.start();

    expect(onBecomeLeaderA).toHaveBeenCalledOnce();
    expect(onBecomeLeaderB).not.toHaveBeenCalled();
    expect(tabA.meshLeader).toBe(true);
    expect(tabB.meshLeader).toBe(false);

    tabA.publishSync([9, 8, 7]);
    expect(onSyncB).toHaveBeenCalledWith([9, 8, 7]);

    tabA.stop();
    tabB.stop();
  });

  it("hands off leadership when the leader tab leaves", () => {
    const onBecomeLeaderB = vi.fn();

    const tabA = new DocsCollabTabCoordinator(
      "docs/test.md",
      {
        onSyncFromTab: vi.fn(),
        onAwarenessFromTab: vi.fn(),
        onMeshStateFromLeader: vi.fn(),
        onBecomeLeader: vi.fn(),
        onResignLeader: vi.fn(),
      },
      "tab-a",
    );
    const tabB = new DocsCollabTabCoordinator(
      "docs/test.md",
      {
        onSyncFromTab: vi.fn(),
        onAwarenessFromTab: vi.fn(),
        onMeshStateFromLeader: vi.fn(),
        onBecomeLeader: onBecomeLeaderB,
        onResignLeader: vi.fn(),
      },
      "tab-b",
    );

    tabA.start();
    tabB.start();
    tabA.stop();

    expect(onBecomeLeaderB).toHaveBeenCalledOnce();
    expect(tabB.meshLeader).toBe(true);

    tabB.stop();
  });

  it("keeps peer connections across a hide/show cycle", () => {
    const onResignLeader = vi.fn();
    const onBecomeLeaderB = vi.fn();
    const handlersFor = (onBecomeLeader: () => void, onResign: () => void) => ({
      onSyncFromTab: vi.fn(),
      onAwarenessFromTab: vi.fn(),
      onMeshStateFromLeader: vi.fn(),
      onBecomeLeader,
      onResignLeader: onResign,
    });

    const tabA = new DocsCollabTabCoordinator(
      "docs/test.md",
      handlersFor(vi.fn(), onResignLeader),
      "tab-a",
    );
    const tabB = new DocsCollabTabCoordinator(
      "docs/test.md",
      handlersFor(onBecomeLeaderB, vi.fn()),
      "tab-b",
    );

    tabA.start();
    tabB.start();
    expect(tabA.meshLeader).toBe(true);

    const setVisibility = (state: DocumentVisibilityState) => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => state,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    };

    setVisibility("hidden");
    setVisibility("visible");

    expect(tabA.meshLeader).toBe(true);
    expect(tabB.meshLeader).toBe(false);
    expect(onResignLeader).not.toHaveBeenCalled();
    expect(onBecomeLeaderB).not.toHaveBeenCalled();

    tabA.stop();
    tabB.stop();
  });
});

/**
 * Manual QA (two-tab same doc):
 * 1. Open the same collab doc in two tabs with detailed connection logs on.
 * 2. Confirm only one tab logs mesh join / WebRTC links (follower shows relayed mesh-state).
 * 3. Type in tab A — text appears in tab B without refresh.
 * 4. Close the leader tab — follower promotes and remote edits still sync.
 */

describe("docs-collab-tab-sync constants", () => {
  it("exports bc-tab origin for Yjs routing", () => {
    expect(BC_TAB_ORIGIN).toBe("bc-tab");
  });
});
