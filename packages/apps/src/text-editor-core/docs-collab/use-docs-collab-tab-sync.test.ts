import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { encodeUpdateBroadcast, handleSyncMessage } from "./docs-collab-mesh-sync";
import { BC_TAB_ORIGIN, isRemoteUpdateOrigin } from "./docs-collab-utils";
import { applyFollowerTabSync } from "./use-docs-collab-tab-sync";

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
