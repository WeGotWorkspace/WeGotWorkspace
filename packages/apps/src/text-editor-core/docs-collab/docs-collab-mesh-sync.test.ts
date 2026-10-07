import * as encoding from "lib0/encoding";
import { describe, expect, it } from "vitest";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import {
  applyAwarenessUpdate,
  encodeFullAwarenessBroadcast,
  encodeSyncStep1,
  encodeUpdateBroadcast,
  handleGuardedSyncMessage,
  handleSyncMessage,
  isDocumentBearingSyncMessage,
  mayRelayGuardedOutcomeToTabs,
} from "./docs-collab-mesh-sync";
import { isYDocEmpty } from "./docs-collab-utils";

describe("docs-collab-mesh-sync", () => {
  it("sync round-trip between two docs via step1 and reply", () => {
    const docA = new Y.Doc();
    const xml = docA.getXmlFragment("default");
    const paragraph = new Y.XmlElement("paragraph");
    const text = new Y.XmlText();
    text.insert(0, "hello");
    paragraph.insert(0, [text]);
    xml.insert(0, [paragraph]);

    const docB = new Y.Doc();
    expect(isYDocEmpty(docB)).toBe(true);

    const step1 = encodeSyncStep1(docB);
    const reply = handleSyncMessage(step1, docA);
    expect(reply).not.toBeNull();
    if (reply) handleSyncMessage(reply.u, docB);

    expect(isYDocEmpty(docB)).toBe(false);
    expect(docB.getXmlFragment("default").length).toBeGreaterThan(0);
  });

  it("encodeUpdateBroadcast produces decodable update", () => {
    const source = new Y.Doc();
    source.getText("default").insert(0, "x");
    const update = Y.encodeStateAsUpdate(source);
    const encoded = encodeUpdateBroadcast(update);
    expect(encoded.length).toBeGreaterThan(0);
  });

  it("applyAwarenessUpdate merges remote awareness", () => {
    const docA = new Y.Doc();
    const awarenessA = new awarenessProtocol.Awareness(docA);
    awarenessA.setLocalStateField("user", { name: "Alex" });

    const docB = new Y.Doc();
    const awarenessB = new awarenessProtocol.Awareness(docB);
    const changed = awarenessProtocol.encodeAwarenessUpdate(awarenessA, [awarenessA.clientID]);
    applyAwarenessUpdate(Array.from(changed), awarenessB);
    expect(awarenessB.getStates().size).toBeGreaterThan(0);
  });

  it("encodeFullAwarenessBroadcast encodes the local client state", () => {
    const doc = new Y.Doc();
    const awareness = new awarenessProtocol.Awareness(doc);
    awareness.setLocalStateField("user", { name: "Alex", color: "#2563eb" });

    const encoded = encodeFullAwarenessBroadcast(awareness);
    expect(encoded).not.toBeNull();
    expect(encoded!.length).toBeGreaterThan(0);

    const remote = new awarenessProtocol.Awareness(new Y.Doc());
    applyAwarenessUpdate(encoded!, remote);
    expect(remote.getStates().get(awareness.clientID)?.user).toEqual({
      name: "Alex",
      color: "#2563eb",
    });
  });
});

describe("handleGuardedSyncMessage", () => {
  function editedDoc(text: string): Y.Doc {
    const doc = new Y.Doc();
    doc.getXmlFragment("default");
    const paragraph = new Y.XmlElement("paragraph");
    const node = new Y.XmlText();
    node.insert(0, text);
    paragraph.insert(0, [node]);
    doc.getXmlFragment("default").insert(0, [paragraph]);
    return doc;
  }

  it("answers a sync step 1 from any rostered peer, reader included", () => {
    const local = editedDoc("shared body");
    const outcome = handleGuardedSyncMessage({
      bytes: encodeSyncStep1(new Y.Doc()),
      ydoc: local,
      trust: { user: "carol", access: "read" },
    });

    expect(outcome.kind).toBe("reply");
    if (outcome.kind !== "reply") return;
    const mirror = new Y.Doc();
    handleGuardedSyncMessage({
      bytes: outcome.reply.u,
      ydoc: mirror,
      trust: { user: "bob", access: "write" },
    });
    expect(mirror.getXmlFragment("default").toJSON()).toContain("shared body");
  });

  it("does not apply an update a reader pushes", () => {
    const local = new Y.Doc();
    local.getXmlFragment("default");
    const update = Y.encodeStateAsUpdate(editedDoc("reader body"));

    const outcome = handleGuardedSyncMessage({
      bytes: encodeUpdateBroadcast(update),
      ydoc: local,
      trust: { user: "carol", access: "read" },
    });

    expect(outcome).toEqual({ kind: "update", verdict: { applied: false, reason: "reader" } });
    expect(isYDocEmpty(local)).toBe(true);
  });

  /** A tampered client can put its edits in a step 2 instead of an update. */
  it("guards a sync step 2 the same way as an update", () => {
    const local = new Y.Doc();
    local.getXmlFragment("default");
    const encoder = encoding.createEncoder();
    syncProtocol.writeSyncStep2(encoder, editedDoc("smuggled body"), Y.encodeStateVector(local));

    const outcome = handleGuardedSyncMessage({
      bytes: Array.from(encoding.toUint8Array(encoder)),
      ydoc: local,
      trust: { user: "carol", access: "comment" },
    });

    expect(outcome).toEqual({
      kind: "update",
      verdict: { applied: false, reason: "body-edit-by-commenter" },
    });
    expect(isYDocEmpty(local)).toBe(true);
  });

  it("applies an editor's update", () => {
    const local = new Y.Doc();
    local.getXmlFragment("default");

    const outcome = handleGuardedSyncMessage({
      bytes: encodeUpdateBroadcast(Y.encodeStateAsUpdate(editedDoc("editor body"))),
      ydoc: local,
      trust: { user: "bob", access: "write" },
    });

    expect(outcome).toEqual({ kind: "update", verdict: { applied: true } });
    expect(local.getXmlFragment("default").toJSON()).toContain("editor body");
  });

  it("treats a message with no established sender as a reader", () => {
    const local = new Y.Doc();
    local.getXmlFragment("default");

    const outcome = handleGuardedSyncMessage({
      bytes: encodeUpdateBroadcast(Y.encodeStateAsUpdate(editedDoc("anonymous body"))),
      ydoc: local,
    });

    expect(outcome).toEqual({ kind: "update", verdict: { applied: false, reason: "reader" } });
    expect(isYDocEmpty(local)).toBe(true);
  });

  it("keeps a refused update out of the relay to the other tabs", () => {
    const local = new Y.Doc();
    local.getXmlFragment("default");
    const bytes = encodeUpdateBroadcast(Y.encodeStateAsUpdate(editedDoc("reader body")));

    const refused = handleGuardedSyncMessage({
      bytes,
      ydoc: local,
      trust: { user: "carol", access: "read" },
    });
    const accepted = handleGuardedSyncMessage({
      bytes,
      ydoc: local,
      trust: { user: "bob", access: "write" },
    });

    expect(mayRelayGuardedOutcomeToTabs(refused)).toBe(false);
    expect(mayRelayGuardedOutcomeToTabs(accepted)).toBe(true);
    expect(
      mayRelayGuardedOutcomeToTabs(
        handleGuardedSyncMessage({ bytes: encodeSyncStep1(new Y.Doc()), ydoc: local }),
      ),
    ).toBe(true);
  });

  it("tells a state request apart from a message carrying content", () => {
    expect(isDocumentBearingSyncMessage(encodeSyncStep1(new Y.Doc()))).toBe(false);
    expect(isDocumentBearingSyncMessage(encodeUpdateBroadcast(new Uint8Array([0, 0])))).toBe(true);
  });

  it("blocks answering step 1 for an empty doc that is not mesh-hydrated yet", () => {
    const local = editedDoc("already here");
    const outcome = handleGuardedSyncMessage({
      bytes: encodeSyncStep1(local),
      ydoc: new Y.Doc(),
      meshHydrated: false,
      trust: { user: "bob", access: "write" },
    });
    expect(outcome).toEqual({ kind: "hydration-blocked" });
  });
});
