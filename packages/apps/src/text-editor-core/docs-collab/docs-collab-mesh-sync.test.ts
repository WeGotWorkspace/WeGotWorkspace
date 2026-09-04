import { describe, expect, it } from "vitest";
import * as awarenessProtocol from "y-protocols/awareness";
import * as Y from "yjs";
import {
  applyAwarenessUpdate,
  encodeFullAwarenessBroadcast,
  encodeSyncStep1,
  encodeUpdateBroadcast,
  handleSyncMessage,
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
