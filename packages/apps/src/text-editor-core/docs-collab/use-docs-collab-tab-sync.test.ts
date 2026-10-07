/** @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as awarenessProtocol from "y-protocols/awareness";
import * as Y from "yjs";
import type { DocsRtcSession } from "./docs-rtc-session";
import type { DocsCollabSessionRefs, DocsCollabTabSyncApi } from "./docs-collab-types";
import { encodeUpdateBroadcast, handleSyncMessage } from "./docs-collab-mesh-sync";
import { BC_TAB_ORIGIN, isRemoteUpdateOrigin } from "./docs-collab-utils";
import { applyFollowerTabSync, useDocsCollabTabSync } from "./use-docs-collab-tab-sync";

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

/**
 * Two tabs share a document and one of them holds the mesh. Typing in the
 * follower must show up on a remote peer. The Yjs update listener treats the
 * BroadcastChannel origin as remote and returns, so the leader has to forward
 * the applied update itself.
 */
describe("applyFollowerTabSync", () => {
  it("leader forwards a follower edit to the remote peer", () => {
    const leader = new Y.Doc();
    const follower = new Y.Doc();
    const remote = new Y.Doc();
    const listener = { broadcast: 0, noted: 0 };
    leader.on("update", (_update, origin) => {
      if (isRemoteUpdateOrigin(origin, null)) return;
      listener.broadcast += 1;
      listener.noted += 1;
    });

    const before = Y.encodeStateVector(follower);
    follower.getXmlFragment("default").insert(0, [new Y.XmlText("from follower")]);
    const encoded = encodeUpdateBroadcast(Y.encodeStateAsUpdate(follower, before));

    const broadcasts: number[][] = [];
    const noted: Uint8Array[] = [];
    applyFollowerTabSync({
      updateBytes: encoded,
      ydoc: leader,
      meshLeader: true,
      broadcast: (message) => broadcasts.push(message.u),
      noteLocalUpdate: (update) => noted.push(update),
      onDocReady: () => {},
    });

    expect(isRemoteUpdateOrigin(BC_TAB_ORIGIN, null)).toBe(true);
    expect(listener).toEqual({ broadcast: 0, noted: 0 });
    expect(broadcasts).toHaveLength(1);
    expect(noted).toHaveLength(1);
    handleSyncMessage(broadcasts[0]!, remote);
    expect(leader.getXmlFragment("default").toString()).toContain("from follower");
    expect(remote.getXmlFragment("default").toString()).toContain("from follower");
  });

  it("does not publish a follower edit from a tab that is not the mesh leader", () => {
    const leader = new Y.Doc();
    const follower = new Y.Doc();
    const before = Y.encodeStateVector(follower);
    follower.getXmlFragment("default").insert(0, [new Y.XmlText("stays local")]);
    const encoded = encodeUpdateBroadcast(Y.encodeStateAsUpdate(follower, before));
    const broadcasts: number[][] = [];

    applyFollowerTabSync({
      updateBytes: encoded,
      ydoc: leader,
      meshLeader: false,
      broadcast: (message) => broadcasts.push(message.u),
      noteLocalUpdate: () => {
        throw new Error("follower must not note a local update");
      },
      onDocReady: () => {},
    });

    expect(broadcasts).toEqual([]);
    expect(leader.getXmlFragment("default").toString()).toContain("stays local");
  });
});

describe("follower awareness relay", () => {
  afterEach(() => {
    MockBroadcastChannel.peers = [];
    vi.unstubAllGlobals();
  });

  it("broadcasts a follower's awareness from the mesh leader exactly once", () => {
    MockBroadcastChannel.peers = [];
    vi.stubGlobal("BroadcastChannel", MockBroadcastChannel);

    const ydoc = new Y.Doc();
    const awareness = new awarenessProtocol.Awareness(ydoc);
    const followerDoc = new Y.Doc();
    const followerAwareness = new awarenessProtocol.Awareness(followerDoc);
    followerAwareness.setLocalStateField("user", { name: "Follower", color: "#dc2626" });
    const updateBytes = Array.from(
      awarenessProtocol.encodeAwarenessUpdate(followerAwareness, [followerAwareness.clientID]),
    );
    const broadcast = vi.fn();

    const { unmount } = renderHook(() => {
      const meshRef = useRef<DocsRtcSession | null>({
        broadcast,
        getMyId: () => "leader-peer",
      } as unknown as DocsRtcSession);
      const ydocRef = useRef(ydoc);
      const awarenessRef = useRef(awareness);
      const authTokenRef = useRef<string | undefined>(undefined);
      const joinGenerationRef = useRef(1);
      const tabSyncRef = useRef<DocsCollabTabSyncApi | null>(null);
      const refs = {
        meshRef,
        ydocRef,
        awarenessRef,
        authTokenRef,
        joinGenerationRef,
      } as unknown as DocsCollabSessionRefs;

      useDocsCollabTabSync({
        refs,
        room: "docs/awareness-relay.md",
        userName: "Leader",
        joined: true,
        mesh: {
          joinMesh: vi.fn(),
          leaveMeshAsFollower: vi.fn(async () => undefined),
          applyRelayedMeshState: vi.fn(),
          publishMeshStateToTabs: vi.fn(),
        },
        join: {
          connectMeshInBackground: vi.fn(async () => undefined),
          markDocReady: vi.fn(),
          trySeedFromFile: vi.fn(),
        },
        tabSyncRef,
      });
    });

    const follower = new MockBroadcastChannel("wgw.docs-collab.tab:docs/awareness-relay.md");
    follower.postMessage({ type: "awareness", u: updateBytes, fromTab: "follower-tab" });

    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledWith({ type: "awareness", u: updateBytes });

    unmount();
    awareness.destroy();
    followerAwareness.destroy();
    ydoc.destroy();
    followerDoc.destroy();
  });
});
