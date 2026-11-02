/** @vitest-environment jsdom */
import "fake-indexeddb/auto";
import { act, renderHook } from "@testing-library/react";
import * as decoding from "lib0/decoding";
import { useCallback, useEffect, useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { IndexeddbPersistence } from "y-indexeddb";
import * as awarenessProtocol from "y-protocols/awareness";
import * as Y from "yjs";
import { resetDocsCollabMeshLingerForTests } from "./docs-collab-mesh-linger";
import { encodeUpdateBroadcast } from "./docs-collab-mesh-sync";
import { resolveDocsCollabDatabase } from "./docs-collab-persistence";
import { DOC_STATUS_RESTORED_WORKING_VERSION } from "./docs-collab-status";
import { isYDocEmpty } from "./docs-collab-utils";
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

type EchoSessionOptions = {
  room?: string;
  onDocStatus?: (status: string | ((prev: string) => string)) => void;
  updatePendingState?: (pending: boolean, failed?: boolean) => Promise<void>;
};

function useEchoSession(
  userName: string,
  { room = ROOM, onDocStatus, updatePendingState }: EchoSessionOptions = {},
): {
  refs: DocsCollabSessionRefs;
  handleMeshMessage: (msg: DocsCollabMeshMessage) => void;
  applyServerBootstrap: (generation: number, authToken: string | undefined) => Promise<void>;
  trySeedFromFile: () => void;
  snapshotPreview: string | null;
  join: () => Promise<void>;
  teardown: () => void;
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
  const urls = { ...DEFAULT_DOCS_COLLAB_URLS, room };
  const mesh = useDocsCollabMesh({
    refs,
    room,
    urls,
    markDocReady,
    trySeedFromFile,
    setDocStatus: onDocStatus ?? (() => undefined),
  });
  const join = useDocsCollabJoin({
    refs,
    room,
    urls,
    userName,
    mesh,
    save: {
      updatePendingState: updatePendingState ?? (async () => undefined),
      flushPendingSaveIfReady: () => undefined,
    },
    setDocStatus: onDocStatus ?? (() => undefined),
    setLastSavedAt: () => undefined,
    setPendingSync: () => undefined,
    setFailedSync: () => undefined,
  });
  markDocReadyRef.current = join.markDocReady;
  trySeedFromFileRef.current = join.trySeedFromFile;
  return {
    refs,
    handleMeshMessage: mesh.handleMeshMessage,
    applyServerBootstrap: join.applyServerBootstrap,
    trySeedFromFile: join.trySeedFromFile,
    snapshotPreview: join.snapshotPreview,
    join: join.join,
    teardown: join.teardown,
  };
}

function decodeAwarenessStates(update: Uint8Array): Array<{ clientID: number; state: unknown }> {
  const decoder = decoding.createDecoder(update);
  const len = decoding.readVarUint(decoder);
  const states: Array<{ clientID: number; state: unknown }> = [];
  for (let index = 0; index < len; index += 1) {
    const clientID = decoding.readVarUint(decoder);
    decoding.readVarUint(decoder);
    const state = JSON.parse(decoding.readVarString(decoder)) as unknown;
    states.push({ clientID, state });
  }
  return states;
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
  seedDone = true,
): awarenessProtocol.Awareness {
  const awareness = new awarenessProtocol.Awareness(doc);
  awareness.setLocalStateField("user", { name: mesh.name, color: "#2563eb", id: mesh.id });
  refs.ydocRef.current = doc;
  refs.awarenessRef.current = awareness;
  refs.meshRef.current = mesh as unknown as DocsRtcSession;
  refs.seedDoneRef.current = seedDone;
  refs.pendingMarkdownRef.current = "";
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

  it("exchanges one step 1 each when both docs are empty and unseeded", () => {
    const left = renderHook(() => useEchoSession("Ada"));
    const right = renderHook(() => useEchoSession("Bea"));
    const meshA = new LinkedMesh("ada", "Ada");
    const meshB = new LinkedMesh("bea", "Bea");
    meshA.peer = meshB;
    meshB.peer = meshA;
    meshA.onMessage((msg) => left.result.current.handleMeshMessage(msg));
    meshB.onMessage((msg) => right.result.current.handleMeshMessage(msg));

    const docA = new Y.Doc();
    docA.getXmlFragment("default");
    const docB = new Y.Doc();
    docB.getXmlFragment("default");
    const awarenessA = attachSession(left.result.current.refs, meshA, docA, false);
    const awarenessB = attachSession(right.result.current.refs, meshB, docB, false);

    act(() => {
      meshA.broadcast({ type: "dc-open", from: meshA.id });
      meshB.broadcast({ type: "dc-open", from: meshB.id });
    });

    const syncs = [...meshA.sent, ...meshB.sent].filter((msg) => msg.type === "sync");
    expect(syncs).toHaveLength(2);
    expect(isYDocEmpty(docA)).toBe(true);
    expect(isYDocEmpty(docB)).toBe(true);

    awarenessA.destroy();
    awarenessB.destroy();
    docA.destroy();
    docB.destroy();
    left.unmount();
    right.unmount();
  });

  it("does not seed a failed sidecar and matches the peer after sync", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("format=yjs")) {
          return new Response(JSON.stringify({ error: "lock_unavailable" }), { status: 503 });
        }
        return new Response("# Already on the sidecar\n", { status: 200 });
      }),
    );
    vi.useFakeTimers();
    const hook = renderHook(() => useEchoSession("Ada"));
    const local = new Y.Doc();
    local.getXmlFragment("default");
    const awareness = new awarenessProtocol.Awareness(local);
    hook.result.current.refs.ydocRef.current = local;
    hook.result.current.refs.awarenessRef.current = awareness;
    hook.result.current.refs.seedDoneRef.current = false;
    hook.result.current.refs.meshRef.current = null;

    const pending = hook.result.current.applyServerBootstrap(0, "token");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7_000);
    });
    await pending;

    expect(isYDocEmpty(local)).toBe(true);
    expect(hook.result.current.snapshotPreview).toContain("Already on the sidecar");

    hook.result.current.refs.meshRef.current = {
      getPeerIds: () => ["peer"],
      getMyId: () => "ada",
      getMyName: () => "Ada",
      linkCount: () => 1,
      getRoomPeerStatuses: () => [],
      sendTo: () => undefined,
      broadcast: () => undefined,
    } as unknown as DocsRtcSession;
    hook.result.current.trySeedFromFile();
    expect(isYDocEmpty(local)).toBe(true);
    // The doc can already be marked ready when the peer update arrives.
    hook.result.current.refs.seedDoneRef.current = true;

    const peer = new Y.Doc();
    writeBody(peer, "from the peer");
    act(() => {
      hook.result.current.handleMeshMessage({
        type: "sync",
        u: encodeUpdateBroadcast(Y.encodeStateAsUpdate(peer)),
        from: "peer",
        trust: { user: "Bea", access: "write" },
      });
    });

    expect(bodyText(local)).toBe("from the peer");
    expect(bodyText(peer)).toBe("from the peer");
    expect(hook.result.current.snapshotPreview).toBeNull();

    awareness.destroy();
    local.destroy();
    peer.destroy();
    hook.unmount();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});

describe("useDocsCollabJoin teardown", () => {
  it("broadcasts a null awareness state for this client when the joined hook unmounts", async () => {
    const broadcasts: DocsCollabMeshMessage[] = [];
    const hook = renderHook(() => {
      const session = useEchoSession("Ada");
      const teardownRef = useRef(session.teardown);
      teardownRef.current = session.teardown;
      useEffect(() => () => teardownRef.current(), []);
      return session;
    });

    await act(async () => {
      await hook.result.current.join();
    });

    const awareness = hook.result.current.refs.awarenessRef.current;
    if (!awareness) throw new Error("expected a joined awareness");
    const clientId = awareness.clientID;
    hook.result.current.refs.meshRef.current = {
      broadcast: (msg: DocsCollabMeshMessage) => {
        broadcasts.push(msg);
      },
      clearMessageListeners: () => undefined,
      leave: async () => undefined,
    } as unknown as DocsRtcSession;

    act(() => {
      hook.unmount();
    });

    const awarenessMessages = broadcasts.filter((msg) => msg.type === "awareness");
    expect(awarenessMessages).toHaveLength(1);
    const message = awarenessMessages[0];
    if (!message || message.type !== "awareness") throw new Error("missing awareness broadcast");
    expect(decodeAwarenessStates(message.u)).toContainEqual({
      clientID: clientId,
      state: null,
    });
    resetDocsCollabMeshLingerForTests();
  });

  it("restores local awareness when pageshow returns from the back/forward cache", () => {
    const hook = renderHook(() => useEchoSession("Ada"));
    const doc = new Y.Doc();
    const awareness = attachSession(hook.result.current.refs, new LinkedMesh("ada", "Ada"), doc);
    const before = awareness.getLocalState();

    act(() => {
      window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    });
    expect(awareness.getLocalState()).toBeNull();

    act(() => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false }));
    });
    expect(awareness.getLocalState()).toBeNull();

    act(() => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    expect(awareness.getLocalState()).toBe(before);

    awareness.destroy();
    doc.destroy();
    hook.unmount();
  });

  it("does not restore awareness after the hook has torn down", () => {
    const hook = renderHook(() => useEchoSession("Ada"));
    const doc = new Y.Doc();
    const awareness = attachSession(hook.result.current.refs, new LinkedMesh("ada", "Ada"), doc);

    act(() => {
      window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    });
    expect(awareness.getLocalState()).toBeNull();

    hook.result.current.refs.meshRef.current = {
      clearMessageListeners: () => undefined,
      leave: async () => undefined,
      broadcast: () => undefined,
    } as unknown as DocsRtcSession;
    act(() => {
      hook.result.current.teardown();
    });

    act(() => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    expect(hook.result.current.refs.awarenessRef.current).toBeNull();
    expect(awareness.getLocalState()).toBeNull();

    awareness.destroy();
    doc.destroy();
    hook.unmount();
    resetDocsCollabMeshLingerForTests();
  });
});

describe("useDocsCollabJoin server bootstrap", () => {
  /** Writes `doc` into the room's IndexedDB copy, as an earlier visit would have. */
  async function storeLocalCopy(room: string, doc: Y.Doc): Promise<void> {
    const database = await resolveDocsCollabDatabase(room);
    const persistence = new IndexeddbPersistence(database.name, new Y.Doc());
    await persistence.whenSynced;
    Y.applyUpdate(persistence.doc, Y.encodeStateAsUpdate(doc));
    await persistence.destroy();
  }

  function stubServer(snapshot: Y.Doc, markdown: string): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes("format=yjs")) {
          return new Response(Y.encodeStateAsUpdate(snapshot) as unknown as BodyInit, {
            status: 200,
            headers: { ETag: '"sidecar-1"' },
          });
        }
        return new Response(markdown, { status: 200 });
      }),
    );
  }

  function renderJoinedSession(room: string) {
    const statuses: string[] = [];
    let current = "";
    const pendingCalls: boolean[] = [];
    const hook = renderHook(() =>
      useEchoSession("Ada", {
        room,
        onDocStatus: (status) => {
          current = typeof status === "function" ? status(current) : status;
          statuses.push(current);
        },
        updatePendingState: async (pending) => {
          pendingCalls.push(pending);
        },
      }),
    );
    return { hook, statuses, pendingCalls };
  }

  async function bootstrap(hook: ReturnType<typeof renderJoinedSession>["hook"]): Promise<void> {
    const refs = hook.result.current.refs;
    await act(async () => {
      await hook.result.current.applyServerBootstrap(refs.joinGenerationRef.current, "token");
    });
  }

  function closeSession(hook: ReturnType<typeof renderJoinedSession>["hook"]): void {
    act(() => {
      hook.result.current.teardown();
    });
    hook.unmount();
    resetDocsCollabMeshLingerForTests();
    vi.unstubAllGlobals();
  }

  it("keeps characters typed before the server snapshot lands", async () => {
    const room = "docs/bootstrap-early-typing.md";
    const server = new Y.Doc();
    writeBody(server, "Line two");
    await storeLocalCopy(room, server);
    stubServer(server, "Line two\n");
    const { hook, statuses, pendingCalls } = renderJoinedSession(room);

    await act(async () => {
      await hook.result.current.join();
    });
    const local = hook.result.current.refs.ydocRef.current;
    if (!local) throw new Error("expected a joined doc");
    expect(bodyText(local)).toBe("Line two");

    const paragraph = local.getXmlFragment("default").get(0) as Y.XmlElement;
    (paragraph.get(0) as Y.XmlText).insert(8, " [early]");
    await bootstrap(hook);

    expect(bodyText(local)).toBe("Line two [early]");
    // The kept edit still has to reach the server, also after a reload.
    expect(hook.result.current.refs.localDirtySinceLastSaveRef.current).toBe(true);
    expect(pendingCalls).toContain(true);
    // Nothing local was dropped, so this is a plain open.
    expect(statuses).not.toContain(DOC_STATUS_RESTORED_WORKING_VERSION);

    closeSession(hook);
    server.destroy();
  });

  it("keeps an offline edit when the server has no collab state yet (204)", async () => {
    const room = "docs/bootstrap-no-sidecar.md";
    // Opened offline before: the local copy came from the cached text.
    const cached = new Y.Doc();
    writeBody(cached, "Body to clear");
    await storeLocalCopy(room, cached);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).includes("format=yjs")
          ? new Response(null, { status: 204 })
          : new Response("Body to clear\n", { status: 200 }),
      ),
    );
    const { hook, pendingCalls } = renderJoinedSession(room);
    await act(async () => {
      await hook.result.current.join();
    });
    const local = hook.result.current.refs.ydocRef.current;
    if (!local) throw new Error("expected a joined doc");

    // Cleared while offline, then the connection comes back.
    const fragment = local.getXmlFragment("default");
    fragment.delete(0, fragment.length);
    await bootstrap(hook);

    expect(bodyText(local)).toBe("");
    expect(hook.result.current.refs.localDirtySinceLastSaveRef.current).toBe(true);
    expect(pendingCalls).toContain(true);

    closeSession(hook);
    cached.destroy();
  });

  it("drops a stale local seed but keeps what was typed on top of it", async () => {
    const room = "docs/bootstrap-stale-seed.md";
    const stale = new Y.Doc();
    writeBody(stale, "local seed");
    await storeLocalCopy(room, stale);
    const server = new Y.Doc();
    writeBody(server, "server copy");
    stubServer(server, "server copy\n");
    const { hook, statuses } = renderJoinedSession(room);

    await act(async () => {
      await hook.result.current.join();
    });
    const local = hook.result.current.refs.ydocRef.current;
    if (!local) throw new Error("expected a joined doc");
    expect(bodyText(local)).toBe("local seed");

    writeBody(local, "typed early");
    await bootstrap(hook);

    const text = local.getXmlFragment("default").toString();
    expect(text).toContain("server copy");
    expect(text).toContain("typed early");
    expect(text).not.toContain("local seed");
    expect(statuses).toContain(DOC_STATUS_RESTORED_WORKING_VERSION);

    closeSession(hook);
    stale.destroy();
    server.destroy();
  });

  it("keeps text another tab typed that the server snapshot does not have yet (#1722)", async () => {
    const room = "docs/bootstrap-other-tab-unsaved.md";
    const server = new Y.Doc();
    writeBody(server, "Saved line");
    // The other tab typed into the shared local copy; its debounced save is still waiting.
    const otherTab = new Y.Doc();
    Y.applyUpdate(otherTab, Y.encodeStateAsUpdate(server));
    const paragraph = otherTab.getXmlFragment("default").get(0) as Y.XmlElement;
    (paragraph.get(0) as Y.XmlText).insert(10, " typed just now");
    await storeLocalCopy(room, otherTab);
    stubServer(server, "Saved line\n");
    const { hook, statuses } = renderJoinedSession(room);

    await act(async () => {
      await hook.result.current.join();
    });
    const local = hook.result.current.refs.ydocRef.current;
    if (!local) throw new Error("expected a joined doc");
    await bootstrap(hook);

    expect(bodyText(local)).toBe("Saved line typed just now");
    expect(statuses).not.toContain(DOC_STATUS_RESTORED_WORKING_VERSION);

    closeSession(hook);
    otherTab.destroy();
    server.destroy();
  });

  it("does not announce a restored version on a plain open", async () => {
    const room = "docs/bootstrap-plain-open.md";
    const server = new Y.Doc();
    writeBody(server, "Line one");
    await storeLocalCopy(room, server);
    stubServer(server, "Line one\n");
    const { hook, statuses, pendingCalls } = renderJoinedSession(room);

    await act(async () => {
      await hook.result.current.join();
    });
    await bootstrap(hook);

    const local = hook.result.current.refs.ydocRef.current;
    if (!local) throw new Error("expected a joined doc");
    expect(bodyText(local)).toBe("Line one");
    expect(hook.result.current.refs.localDirtySinceLastSaveRef.current).toBe(false);
    expect(pendingCalls).not.toContain(true);
    expect(statuses).not.toContain(DOC_STATUS_RESTORED_WORKING_VERSION);
    // The loading line must not stay behind once the document is in.
    expect(statuses.at(-1)).toBe("");

    closeSession(hook);
    server.destroy();
  });
});
