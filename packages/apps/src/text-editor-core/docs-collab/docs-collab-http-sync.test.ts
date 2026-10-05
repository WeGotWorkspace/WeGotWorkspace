import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import type { DocsCollabAccess } from "./docs-collab-access";
import { DocsCollabHttpSync, type DocsCollabHttpSyncPorts } from "./docs-collab-http-sync";
import { encodeYjsHttpPayload } from "./docs-collab-http-wire";

function harness(access: DocsCollabAccess, doc: Y.Doc) {
  const sent: Array<{ to: string; type: "yjs" | "yjs-sv" }> = [];
  const ports: DocsCollabHttpSyncPorts = {
    now: () => 0,
    peers: () => [],
    webrtcUnavailable: () => false,
    send: (to, type) => {
      sent.push({ to, type });
    },
    sendStateVectorOnChannel: () => {},
    requestRelay: async () => ({ outcome: "relay_unavailable" }),
    onRelay: () => {},
    setFastPoll: () => {},
    getYDoc: () => doc,
    trust: () => ({ access: "write", user: "editor" }),
    myAccess: () => access,
  };
  return { sync: new DocsCollabHttpSync(ports), sent };
}

describe("DocsCollabHttpSync state-vector answers", () => {
  it("publishes a diff only when this client may write", () => {
    const doc = new Y.Doc();
    doc.getXmlFragment("default").insert(0, [new Y.XmlText("body")]);
    const asking = new Y.Doc();
    const message = {
      from: "peer-b",
      type: "yjs-sv",
      payload: encodeYjsHttpPayload(Y.encodeStateVector(asking), 1),
    };

    const writer = harness("write", doc);
    writer.sync.ingest([message]);
    expect(writer.sent.length).toBeGreaterThan(0);
    expect(writer.sent.every((row) => row.to === "peer-b" && row.type === "yjs")).toBe(true);

    const reader = harness("read", doc);
    reader.sync.ingest([message]);
    expect(reader.sent).toEqual([]);

    const commenter = harness("comment", doc);
    commenter.sync.ingest([message]);
    expect(commenter.sent).toEqual([]);
  });
});
