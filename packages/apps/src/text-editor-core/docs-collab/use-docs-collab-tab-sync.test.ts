/** @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as awarenessProtocol from "y-protocols/awareness";
import * as Y from "yjs";
import type { DocsRtcSession } from "./docs-rtc-session";
import type { DocsCollabSessionRefs, DocsCollabTabSyncApi } from "./docs-collab-types";
import { encodeUpdateBroadcast, handleSyncMessage } from "./docs-collab-mesh-sync";
import {
  NOTE_TITLE_YTEXT_KEY,
  noteTitleIsInDoc,
  readNoteTitle,
  writeNoteTitle,
} from "./docs-collab-document-title";
import { LEADER_CLAIM_GRACE_MS } from "./docs-collab-tab-sync";
import { BC_TAB_ORIGIN, isRemoteUpdateOrigin, MESH_ORIGIN } from "./docs-collab-utils";
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

    const broadcasts: Uint8Array[] = [];
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
    const broadcasts: Uint8Array[] = [];

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
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("broadcasts a follower's awareness from the mesh leader exactly once", () => {
    vi.useFakeTimers();
    MockBroadcastChannel.peers = [];
    vi.stubGlobal("BroadcastChannel", MockBroadcastChannel);

    const ydoc = new Y.Doc();
    const awareness = new awarenessProtocol.Awareness(ydoc);
    const followerDoc = new Y.Doc();
    const followerAwareness = new awarenessProtocol.Awareness(followerDoc);
    followerAwareness.setLocalStateField("user", { name: "Follower", color: "#dc2626" });
    const updateBytes = awarenessProtocol.encodeAwarenessUpdate(followerAwareness, [
      followerAwareness.clientID,
    ]);
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

    vi.advanceTimersByTime(LEADER_CLAIM_GRACE_MS);
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

/**
 * Two tabs of one account. Only the leader tab holds the mesh, so the follower
 * sees the other account's edits and carets only through what the leader puts
 * on the BroadcastChannel.
 */
describe("follower tab receives the leader's mesh traffic", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    MockBroadcastChannel.peers = [];
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const room = "docs/follower-relay.md";

  function mountTab(ydoc: Y.Doc, awareness: awarenessProtocol.Awareness) {
    const tabSyncRef: { current: DocsCollabTabSyncApi | null } = { current: null };
    const hook = renderHook(() => {
      const meshRef = useRef<DocsRtcSession | null>({
        broadcast: vi.fn(),
        noteLocalUpdate: vi.fn(),
        getMyId: () => "leader-peer",
      } as unknown as DocsRtcSession);
      const ydocRef = useRef(ydoc);
      const awarenessRef = useRef(awareness);
      const authTokenRef = useRef<string | undefined>(undefined);
      const joinGenerationRef = useRef(1);
      const refs = {
        meshRef,
        ydocRef,
        awarenessRef,
        authTokenRef,
        joinGenerationRef,
      } as unknown as DocsCollabSessionRefs;
      useDocsCollabTabSync({
        refs,
        room,
        userName: "Admin",
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
    // Same contract as the Y.Doc listener in useDocsCollabJoin: local edits go to the tabs.
    ydoc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === BC_TAB_ORIGIN || origin === MESH_ORIGIN) return;
      tabSyncRef.current?.onLocalSync(encodeUpdateBroadcast(update));
    });
    vi.advanceTimersByTime(LEADER_CLAIM_GRACE_MS);
    return { tabSyncRef, unmount: hook.unmount };
  }

  function remoteEdit(remote: Y.Doc, edit: () => void): Uint8Array {
    const before = Y.encodeStateVector(remote);
    remote.transact(edit);
    return encodeUpdateBroadcast(Y.encodeStateAsUpdate(remote, before));
  }

  it("applies relayed sync and awareness from the leader tab", () => {
    vi.stubGlobal("BroadcastChannel", MockBroadcastChannel);
    const leaderDoc = new Y.Doc();
    const followerDoc = new Y.Doc();
    const leader = mountTab(leaderDoc, new awarenessProtocol.Awareness(leaderDoc));
    const followerAwareness = new awarenessProtocol.Awareness(followerDoc);
    const follower = mountTab(followerDoc, followerAwareness);
    expect(leader.tabSyncRef.current?.isMeshLeader()).toBe(true);
    expect(follower.tabSyncRef.current?.isMeshLeader()).toBe(false);

    const remote = new Y.Doc();
    const remoteAwareness = new awarenessProtocol.Awareness(remote);
    remoteAwareness.setLocalStateField("user", { name: "Member", color: "#2563eb" });
    const sync = remoteEdit(remote, () => {
      remote.getText(NOTE_TITLE_YTEXT_KEY).insert(0, "Carets 179");
    });
    const awarenessBytes = awarenessProtocol.encodeAwarenessUpdate(remoteAwareness, [
      remoteAwareness.clientID,
    ]);

    // What useDocsCollabMesh does after the leader applied a mesh message.
    handleSyncMessage(sync, leaderDoc);
    leader.tabSyncRef.current?.relayMeshMessage({ type: "sync", u: sync, from: "member-peer" });
    leader.tabSyncRef.current?.relayMeshMessage({
      type: "awareness",
      u: awarenessBytes,
      from: "member-peer",
    });

    expect(readNoteTitle(followerDoc)).toBe("Carets 179");
    expect(followerAwareness.getStates().get(remoteAwareness.clientID)).toMatchObject({
      user: { name: "Member" },
    });

    leader.unmount();
    follower.unmount();
  });

  it("pulls what the leader already has when the follower tab opens later", () => {
    vi.stubGlobal("BroadcastChannel", MockBroadcastChannel);
    const remote = new Y.Doc();
    const leaderDoc = new Y.Doc();
    const leader = mountTab(leaderDoc, new awarenessProtocol.Awareness(leaderDoc));

    // The other account typed the title and body before the second tab opened.
    handleSyncMessage(
      remoteEdit(remote, () => {
        remote.getText(NOTE_TITLE_YTEXT_KEY).insert(0, "Carets 179");
        remote.getXmlFragment("default").insert(0, [new Y.XmlText("member body")]);
      }),
      leaderDoc,
      MESH_ORIGIN,
    );

    const followerDoc = new Y.Doc();
    const follower = mountTab(followerDoc, new awarenessProtocol.Awareness(followerDoc));
    expect(follower.tabSyncRef.current?.isMeshLeader()).toBe(false);
    expect(noteTitleIsInDoc(followerDoc)).toBe(true);
    expect(readNoteTitle(followerDoc)).toBe("Carets 179");
    expect(followerDoc.getXmlFragment("default").toString()).toContain("member body");

    // A later live edit from the other account depends on the earlier one.
    const later = remoteEdit(remote, () => {
      remote.getXmlFragment("default").insert(1, [new Y.XmlText(" more")]);
    });
    handleSyncMessage(later, leaderDoc, MESH_ORIGIN);
    leader.tabSyncRef.current?.relayMeshMessage({ type: "sync", u: later, from: "member-peer" });
    expect(followerDoc.getXmlFragment("default").toString()).toContain("more");

    // Typing in the follower's title edits the one shared title.
    writeNoteTitle(followerDoc, "Carets 179X");
    expect(readNoteTitle(leaderDoc)).toBe("Carets 179X");

    leader.unmount();
    follower.unmount();
  });

  it("sends a follower's offline edits to the leader when it opens", () => {
    vi.stubGlobal("BroadcastChannel", MockBroadcastChannel);
    const leaderDoc = new Y.Doc();
    const leader = mountTab(leaderDoc, new awarenessProtocol.Awareness(leaderDoc));

    const followerDoc = new Y.Doc();
    followerDoc.getXmlFragment("default").insert(0, [new Y.XmlText("offline draft")]);
    const follower = mountTab(followerDoc, new awarenessProtocol.Awareness(followerDoc));

    expect(leaderDoc.getXmlFragment("default").toString()).toContain("offline draft");

    leader.unmount();
    follower.unmount();
  });
});
