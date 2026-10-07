/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { useCallback, useRef } from "react";
import { describe, expect, it } from "vitest";
import * as awarenessProtocol from "y-protocols/awareness";
import * as Y from "yjs";
import { encodeUpdateBroadcast } from "./docs-collab-mesh-sync";
import {
  DEFAULT_DOCS_COLLAB_URLS,
  type DocsCollabMeshMessage,
  type DocsCollabSessionRefs,
} from "./docs-collab-types";
import { DEFAULT_DOCS_COLLAB_WIRE } from "./docs-collab-wire";
import type { DocsRtcSession } from "./docs-rtc-session";
import { useDocsCollabJoin } from "./use-docs-collab-join";
import { useDocsCollabMesh } from "./use-docs-collab-mesh";
import { useDocsCollabSessionRefs } from "./use-docs-collab-session-refs";

const ROOM = "docs/echo-loop.md";
/** Stop a synchronous echo from overflowing the stack. The assertion is stricter. */
const DELIVERY_CAP = 40;

/**
 * In-memory stand-in for two open data channels. Each send is delivered to the
 * other session's mesh handler before the send returns.
 */
class LinkedMesh {
  readonly sent: DocsCollabMeshMessage[] = [];
  peer: LinkedMesh | null = null;
  private readonly listeners = new Set<(msg: DocsCollabMeshMessage) => void>();

  constructor(
    readonly id: string,
    readonly name: string,
  ) {}

  onMessage(listener: (msg: DocsCollabMeshMessage) => void): void {
    this.listeners.add(listener);
  }

  broadcast(msg: DocsCollabMeshMessage): void {
    this.forward(msg);
  }

  sendTo(_remoteId: string, msg: DocsCollabMeshMessage): void {
    this.forward(msg);
  }

  getMyName(): string {
    return this.name;
  }

  linkCount(): number {
    return this.peer ? 1 : 0;
  }

  getRoomPeerStatuses(): Array<{ id: string; name: string; link: "connected" }> {
    return this.peer ? [{ id: this.peer.id, name: this.peer.name, link: "connected" }] : [];
  }

  private forward(msg: DocsCollabMeshMessage): void {
    this.sent.push(msg);
    const peer = this.peer;
    if (!peer || this.sent.length + peer.sent.length >= DELIVERY_CAP) return;
    const incoming = withSender(msg, this.id, this.name);
    for (const listener of peer.listeners) listener(incoming);
  }
}

function withSender(msg: DocsCollabMeshMessage, id: string, name: string): DocsCollabMeshMessage {
  if (msg.type === "sync") {
    return { ...msg, from: id, trust: msg.trust ?? { user: name, access: "write" } };
  }
  if (
    msg.type === "awareness" ||
    msg.type === "peer-hint" ||
    msg.type === "dc-open" ||
    msg.type === "resync"
  ) {
    return { ...msg, from: id };
  }
  return msg;
}

function useEchoSession(userName: string): {
  refs: DocsCollabSessionRefs;
  handleMeshMessage: (msg: DocsCollabMeshMessage) => void;
} {
  const refs = useDocsCollabSessionRefs(DEFAULT_DOCS_COLLAB_WIRE, undefined);
  const markDocReadyRef = useRef<() => void>(() => undefined);
  const trySeedFromFileRef = useRef<() => void>(() => undefined);
  const markDocReady = useCallback(() => {
    markDocReadyRef.current();
  }, []);
  const trySeedFromFile = useCallback(() => {
    trySeedFromFileRef.current();
  }, []);
  const urls = { ...DEFAULT_DOCS_COLLAB_URLS, room: ROOM };
  const mesh = useDocsCollabMesh({
    refs,
    room: ROOM,
    urls,
    markDocReady,
    trySeedFromFile,
  });
  const join = useDocsCollabJoin({
    refs,
    room: ROOM,
    urls,
    userName,
    mesh,
    save: {
      updatePendingState: async () => undefined,
      flushPendingSaveIfReady: () => undefined,
    },
    setDocStatus: () => undefined,
    setLastSavedAt: () => undefined,
    setPendingSync: () => undefined,
    setFailedSync: () => undefined,
  });
  markDocReadyRef.current = join.markDocReady;
  trySeedFromFileRef.current = join.trySeedFromFile;
  return { refs, handleMeshMessage: mesh.handleMeshMessage };
}

function writeBody(doc: Y.Doc, text: string): Y.XmlText {
  const xml = doc.getXmlFragment("default");
  const paragraph = new Y.XmlElement("paragraph");
  const node = new Y.XmlText();
  node.insert(0, text);
  paragraph.insert(0, [node]);
  xml.insert(0, [paragraph]);
  return node;
}

function bodyText(doc: Y.Doc): string {
  const paragraph = doc.getXmlFragment("default").get(0);
  if (!(paragraph instanceof Y.XmlElement)) return "";
  const node = paragraph.get(0);
  return node instanceof Y.XmlText ? node.toString() : "";
}

function attachSession(
  refs: DocsCollabSessionRefs,
  mesh: LinkedMesh,
  doc: Y.Doc,
): awarenessProtocol.Awareness {
  const awareness = new awarenessProtocol.Awareness(doc);
  awareness.setLocalStateField("user", { name: mesh.name, color: "#2563eb", id: mesh.id });
  refs.ydocRef.current = doc;
  refs.awarenessRef.current = awareness;
  refs.meshRef.current = mesh as unknown as DocsRtcSession;
  refs.seedDoneRef.current = true;
  return awareness;
}

describe("useDocsCollabJoin markDocReady", () => {
  it("keeps sent messages under 10 after two linked sessions exchange one change", () => {
    const left = renderHook(() => useEchoSession("Ada"));
    const right = renderHook(() => useEchoSession("Bea"));
    const meshA = new LinkedMesh("ada", "Ada");
    const meshB = new LinkedMesh("bea", "Bea");
    meshA.peer = meshB;
    meshB.peer = meshA;
    meshA.onMessage((msg) => left.result.current.handleMeshMessage(msg));
    meshB.onMessage((msg) => right.result.current.handleMeshMessage(msg));

    const docA = new Y.Doc();
    const text = writeBody(docA, "hello");
    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const awarenessA = attachSession(left.result.current.refs, meshA, docA);
    const awarenessB = attachSession(right.result.current.refs, meshB, docB);

    const before = Y.encodeStateVector(docA);
    text.insert(5, "!");
    const update = encodeUpdateBroadcast(Y.encodeStateAsUpdate(docA, before));

    act(() => {
      meshA.broadcast({ type: "sync", u: update });
    });

    expect(bodyText(docB)).toBe("hello!");
    expect(meshA.sent.length + meshB.sent.length).toBeLessThan(10);

    awarenessA.destroy();
    awarenessB.destroy();
    docA.destroy();
    docB.destroy();
    left.unmount();
    right.unmount();
  });
});
