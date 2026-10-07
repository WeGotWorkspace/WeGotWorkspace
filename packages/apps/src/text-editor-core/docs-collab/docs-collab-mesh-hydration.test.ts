import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { isDestructiveBodyWipe, isMeshDocumentHydrated } from "./docs-collab-mesh-hydration";
import { applyGuardedRemoteUpdate } from "./docs-collab-update-guard";
import {
  encodeSyncStep1,
  encodeUpdateBroadcast,
  handleGuardedSyncMessage,
  handleSyncMessage,
} from "./docs-collab-mesh-sync";
import { isYDocEmpty } from "./docs-collab-utils";

function docWithBody(text: string): Y.Doc {
  const doc = new Y.Doc();
  const paragraph = new Y.XmlElement("paragraph");
  const node = new Y.XmlText();
  node.insert(0, text);
  paragraph.insert(0, [node]);
  doc.getXmlFragment("default").insert(0, [paragraph]);
  return doc;
}

describe("docs-collab-mesh-hydration", () => {
  it("treats a non-empty doc or seedDone as mesh-ready", () => {
    const empty = new Y.Doc();
    expect(isMeshDocumentHydrated(empty, false)).toBe(false);
    expect(isMeshDocumentHydrated(empty, true)).toBe(true);
    expect(isMeshDocumentHydrated(docWithBody("x"), false)).toBe(true);
  });

  it("detects a broadcast update that clears a populated body", () => {
    const full = docWithBody("keep me");
    const refresher = new Y.Doc();
    Y.applyUpdate(refresher, Y.encodeStateAsUpdate(full));
    refresher.transact(() => {
      const fragment = refresher.getXmlFragment("default");
      if (fragment.length > 0) fragment.delete(0, fragment.length);
    }, "local");
    const wipeUpdate = Y.encodeStateAsUpdate(refresher, Y.encodeStateVector(full));
    expect(isDestructiveBodyWipe(full, wipeUpdate)).toBe(true);
  });

  it("does not answer sync step 1 while the local doc is still empty", () => {
    const full = docWithBody("peer body");
    const empty = new Y.Doc();
    empty.getXmlFragment("default");

    const outcome = handleGuardedSyncMessage({
      bytes: encodeSyncStep1(full),
      ydoc: empty,
      meshHydrated: false,
      trust: { user: "bob", access: "write" },
    });
    expect(outcome).toEqual({ kind: "hydration-blocked" });
    expect(isYDocEmpty(empty)).toBe(true);
  });

  it("lets a hydrated empty doc answer sync step 1 (intentionally blank file)", () => {
    const full = docWithBody("peer body");
    const empty = new Y.Doc();
    empty.getXmlFragment("default");

    const outcome = handleGuardedSyncMessage({
      bytes: encodeSyncStep1(full),
      ydoc: empty,
      meshHydrated: true,
      trust: { user: "bob", access: "write" },
    });
    expect(outcome.kind).toBe("reply");
  });

  it("prevents a full document from applying a peer update that clears the body", () => {
    const full = docWithBody("team content");
    const refresher = new Y.Doc();
    Y.applyUpdate(refresher, Y.encodeStateAsUpdate(full));
    refresher.transact(() => {
      const fragment = refresher.getXmlFragment("default");
      if (fragment.length > 0) fragment.delete(0, fragment.length);
    }, "local");
    const bytes = Array.from(Y.encodeStateAsUpdate(refresher, Y.encodeStateVector(full)));

    const outcome = handleGuardedSyncMessage({
      bytes: encodeUpdateBroadcast(new Uint8Array(bytes)),
      ydoc: full,
      trust: { user: "refreshed", access: "write" },
    });
    expect(outcome).toEqual({
      kind: "update",
      verdict: { applied: false, reason: "destructive-body-wipe" },
    });
    expect(full.getXmlFragment("default").toJSON()).toContain("team content");
  });

  it("reproduces the refresh wipe vector (small delete diff clears the peer body)", () => {
    const full = docWithBody("team content");
    const refresher = new Y.Doc();
    Y.applyUpdate(refresher, Y.encodeStateAsUpdate(full));
    refresher.transact(() => {
      const fragment = refresher.getXmlFragment("default");
      if (fragment.length > 0) fragment.delete(0, fragment.length);
    }, "local");
    const wipeUpdate = Y.encodeStateAsUpdate(refresher, Y.encodeStateVector(full));
    expect(wipeUpdate.byteLength).toBeLessThan(100);

    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(full));
    Y.applyUpdate(peer, wipeUpdate, "mesh");
    expect(isYDocEmpty(peer)).toBe(true);
  });

  it("still allows an empty refresher to pull state from a full peer", () => {
    const full = docWithBody("team content");
    const empty = new Y.Doc();
    empty.getXmlFragment("default");

    const reply = handleSyncMessage(encodeSyncStep1(empty), full);
    expect(reply).not.toBeNull();
    if (reply) handleSyncMessage(reply.u, empty);

    expect(isYDocEmpty(empty)).toBe(false);
    expect(empty.getXmlFragment("default").toJSON()).toContain("team content");
  });

  it("drops destructive wipes in applyGuardedRemoteUpdate", () => {
    const full = docWithBody("protected");
    const refresher = new Y.Doc();
    Y.applyUpdate(refresher, Y.encodeStateAsUpdate(full));
    refresher.transact(() => {
      const fragment = refresher.getXmlFragment("default");
      if (fragment.length > 0) fragment.delete(0, fragment.length);
    }, "local");
    const update = Y.encodeStateAsUpdate(refresher, Y.encodeStateVector(full));

    expect(
      applyGuardedRemoteUpdate({
        doc: full,
        update,
        access: "write",
        senderUser: "peer",
        origin: "mesh",
      }),
    ).toEqual({ applied: false, reason: "destructive-body-wipe" });
  });
});
