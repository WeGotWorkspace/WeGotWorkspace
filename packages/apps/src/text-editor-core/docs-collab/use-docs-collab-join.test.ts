/** @vitest-environment jsdom */
import "fake-indexeddb/auto";
import { act, renderHook } from "@testing-library/react";
import * as decoding from "lib0/decoding";
import { useCallback, useEffect, useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { IndexeddbPersistence } from "y-indexeddb";
import * as awarenessProtocol from "y-protocols/awareness";
import * as Y from "yjs";
import * as leaveRoom from "./docs-collab-leave-room";
import { resetDocsCollabMeshLingerForTests } from "./docs-collab-mesh-linger";
import { encodeUpdateBroadcast } from "./docs-collab-mesh-sync";
import { resolveDocsCollabDatabase } from "@/lib/collab/docs-collab-persistence";
import { DOC_STATUS_RESTORED_WORKING_VERSION } from "./docs-collab-status";
import { isYDocEmpty } from "@/lib/collab/docs-collab-utils";
import { readNoteTitle, writeNoteTitle } from "@/lib/collab/docs-collab-document-title";
import {
  DEFAULT_DOCS_COLLAB_URLS,
  type DocsCollabMeshMessage,
  type DocsCollabSessionRefs,
  type DocsCollabUrls,
} from "./docs-collab-types";
import {
  TEXT_FIELDS_BODY,
  TEXT_FIELDS_TITLE,
  readTextFields,
  seedTextFields,
} from "./docs-collab-text-fields";
import { DEFAULT_DOCS_COLLAB_WIRE } from "./docs-collab-wire";
import type { DocsRtcSession } from "./docs-rtc-session";
import { useDocsCollabJoin } from "./use-docs-collab-join";
import { useDocsCollabMesh } from "./use-docs-collab-mesh";
import { useDocsCollabSessionRefs } from "./use-docs-collab-session-refs";

vi.mock("./docs-collab-leave-room", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./docs-collab-leave-room")>();
  return { ...actual, closeCollabRoomStore: vi.fn(actual.closeCollabRoomStore) };
});

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
  roomNotPersistent?: boolean;
  roomHeldUntilChecked?: boolean;
  documentShape?: "text-fields";
  onExternalWrite?: DocsCollabUrls["onExternalWrite"];
};

function useEchoSession(
  userName: string,
  {
    room = ROOM,
    onDocStatus,
    updatePendingState,
    roomNotPersistent,
    roomHeldUntilChecked,
    documentShape,
    onExternalWrite,
  }: EchoSessionOptions = {},
): {
  refs: DocsCollabSessionRefs;
  handleMeshMessage: (msg: DocsCollabMeshMessage) => void;
  applyServerBootstrap: (generation: number, authToken: string | undefined) => Promise<void>;
  mergeServerState: (authToken: string | undefined) => Promise<boolean>;
  trySeedFromFile: () => void;
  snapshotPreview: string | null;
  awaitingContent: boolean;
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
  const urls = {
    ...DEFAULT_DOCS_COLLAB_URLS,
    room,
    roomNotPersistent,
    roomHeldUntilChecked,
    documentShape,
    onExternalWrite,
  };
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
    mergeServerState: join.mergeServerState,
    trySeedFromFile: join.trySeedFromFile,
    snapshotPreview: join.snapshotPreview,
    awaitingContent: join.awaitingContent,
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

  it("sends the background save to the room it joined when the room changes in place", async () => {
    const closeStore = vi.mocked(leaveRoom.closeCollabRoomStore);
    closeStore.mockClear();
    const hook = renderHook(
      ({ room }: { room: string }) => {
        const session = useEchoSession("Ada", { room });
        const teardownRef = useRef(session.teardown);
        teardownRef.current = session.teardown;
        useEffect(() => () => teardownRef.current(), []);
        return session;
      },
      { initialProps: { room: "docs/room-a.md" } },
    );

    await act(async () => {
      await hook.result.current.join();
    });
    hook.result.current.refs.saveTimerRef.current = setTimeout(() => undefined, 60_000);

    hook.rerender({ room: "docs/room-b.md" });
    act(() => {
      hook.result.current.teardown();
    });

    expect(closeStore).toHaveBeenCalledTimes(1);
    const target = closeStore.mock.calls[0]?.[1];
    expect(target?.room).toBe("docs/room-a.md");
    expect(target?.urls.room).toBe("docs/room-a.md");
    resetDocsCollabMeshLingerForTests();
  });

  it("saves a room left within the save delay once its save hold was released", async () => {
    const closeStore = vi.mocked(leaveRoom.closeCollabRoomStore);
    closeStore.mockClear();
    const hook = renderHook(
      ({ held }: { held: boolean }) => useEchoSession("Ada", { roomNotPersistent: held }),
      { initialProps: { held: true } },
    );
    await act(async () => {
      await hook.result.current.join();
    });

    // Opened held (a queued write may own the path), then released while open.
    hook.rerender({ held: false });
    hook.result.current.refs.saveTimerRef.current = setTimeout(() => undefined, 60_000);
    act(() => {
      hook.result.current.teardown();
    });

    expect(closeStore).toHaveBeenCalledTimes(1);
    expect(closeStore.mock.calls[0]?.[2]).toMatchObject({ upload: true });
    resetDocsCollabMeshLingerForTests();
  });

  // Every Doc opens held until its path check answers; its text is still on its way (#2056).
  it("holds typing in an empty room that is held only until a check answers", async () => {
    const hook = renderHook(
      ({ checked }: { checked: boolean }) =>
        useEchoSession("Ada", { roomNotPersistent: true, roomHeldUntilChecked: !checked }),
      { initialProps: { checked: false } },
    );
    await act(async () => {
      await hook.result.current.join();
    });
    expect(hook.result.current.awaitingContent).toBe(true);

    // The check answers that a queued create owns the path: nothing is on its way.
    hook.rerender({ checked: true });
    expect(hook.result.current.awaitingContent).toBe(false);
    act(() => {
      hook.result.current.teardown();
    });
    resetDocsCollabMeshLingerForTests();
  });

  it("takes typing at once in an empty room whose server copy does not exist yet", async () => {
    const hook = renderHook(() => useEchoSession("Ada", { roomNotPersistent: true }));
    await act(async () => {
      await hook.result.current.join();
    });
    expect(hook.result.current.awaitingContent).toBe(false);
    act(() => {
      hook.result.current.teardown();
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

/**
 * A text-fields resource (Notes, Tasks) serves its title next to the body.
 * The server stores a writer's state without reading it (#2208), so a state
 * that does not hold the served text, or cannot be read, is not adopted.
 */
describe("useDocsCollabJoin stored state that does not hold the served text", () => {
  function stubTextFields(
    state: Uint8Array,
    body: string,
    title: string | null,
    {
      stateTag = '"text-1"',
      textTag = '"text-1"',
      textFails = false,
    }: { stateTag?: string | null; textTag?: string; textFails?: boolean } = {},
  ): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes("format=yjs")) {
          return new Response(state as unknown as BodyInit, {
            status: 200,
            headers: {
              ETag: '"sidecar-1"',
              ...(stateTag ? { "X-Wgw-Content-Tag": stateTag } : {}),
            },
          });
        }
        if (textFails) return new Response("unavailable", { status: 503 });
        return Response.json({ body, title }, { headers: { ETag: textTag } });
      }),
    );
  }

  function stateWith(body: string, title: string | null): Uint8Array {
    const doc = new Y.Doc();
    writeBody(doc, body);
    if (title !== null) writeNoteTitle(doc, title);
    const update = Y.encodeStateAsUpdate(doc);
    doc.destroy();
    return update;
  }

  async function open(room: string) {
    const hook = renderHook(() => useEchoSession("Ada", { room }));
    await act(async () => {
      await hook.result.current.join();
    });
    await act(async () => {
      await hook.result.current.applyServerBootstrap(
        hook.result.current.refs.joinGenerationRef.current,
        "token",
      );
    });
    const doc = hook.result.current.refs.ydocRef.current;
    if (!doc) throw new Error("expected a joined doc");
    return { hook, doc };
  }

  function close(
    hook: ReturnType<typeof renderHook<ReturnType<typeof useEchoSession>, unknown>>,
  ): void {
    act(() => {
      hook.result.current.teardown();
    });
    hook.unmount();
    resetDocsCollabMeshLingerForTests();
    vi.unstubAllGlobals();
  }

  it("adopts a state that holds the served title and body", async () => {
    stubTextFields(stateWith("Same", "Plan"), "Same\n", "Plan");
    const { hook, doc } = await open("notes/state-matches.md");

    expect(bodyText(doc)).toBe("Same");
    expect(readNoteTitle(doc)).toBe("Plan");
    expect(hook.result.current.refs.localDirtySinceLastSaveRef.current).toBe(false);
    close(hook);
  });

  it("reseeds from the served text when the state holds another text", async () => {
    stubTextFields(stateWith("Planted", "Other"), "Real\n", "Plan");
    const { hook, doc } = await open("notes/state-mismatch.md");

    expect(bodyText(doc)).toBe("Real");
    expect(readNoteTitle(doc)).toBe("Plan");
    // The next save replaces the stored state with one that holds the text.
    expect(hook.result.current.refs.localDirtySinceLastSaveRef.current).toBe(true);
    close(hook);
  });

  it("reseeds from the served text when the state cannot be read", async () => {
    stubTextFields(new Uint8Array([0xff, 0x13, 0x07, 0x01, 0x02, 0x99]), "Real\n", "Plan");
    const { hook, doc } = await open("notes/state-garbage.md");

    expect(bodyText(doc)).toBe("Real");
    expect(readNoteTitle(doc)).toBe("Plan");
    expect(hook.result.current.refs.localDirtySinceLastSaveRef.current).toBe(true);
    close(hook);
  });

  it("adopts on bootstrap when the state and the text are not one save", async () => {
    // A peer saved between the two reads: the text is newer than the state.
    stubTextFields(stateWith("Same", "Plan"), "Same and more\n", "Plan", {
      stateTag: '"text-1"',
      textTag: '"text-2"',
    });
    const { hook, doc } = await open("notes/state-race-bootstrap.md");

    expect(bodyText(doc)).toBe("Same");
    expect(hook.result.current.refs.localDirtySinceLastSaveRef.current).toBe(false);
    expect(hook.result.current.refs.externalWriteHoldRef.current).toBe(false);
    close(hook);
  });

  it("adopts a state with no content tag without reading it against the text", async () => {
    stubTextFields(stateWith("Planted", "Other"), "Real\n", "Plan", { stateTag: null });
    const { hook, doc } = await open("notes/state-untagged.md");

    expect(bodyText(doc)).toBe("Planted");
    expect(hook.result.current.refs.localDirtySinceLastSaveRef.current).toBe(false);
    close(hook);
  });

  it("checks the body of a note with no title", async () => {
    stubTextFields(stateWith("Same", null), "Same\n", null);
    const matching = await open("notes/untitled-match.md");
    expect(bodyText(matching.doc)).toBe("Same");
    expect(matching.hook.result.current.refs.localDirtySinceLastSaveRef.current).toBe(false);
    close(matching.hook);

    stubTextFields(stateWith("Planted", null), "Real\n", null);
    const planted = await open("notes/untitled-planted.md");
    expect(bodyText(planted.doc)).toBe("Real");
    expect(planted.hook.result.current.refs.localDirtySinceLastSaveRef.current).toBe(true);
    close(planted.hook);
  });

  it("adopts on a reconnect merge when the text read is a newer save", async () => {
    const writer = new Y.Doc();
    const body = writeBody(writer, "Same");
    writeNoteTitle(writer, "Plan");
    stubTextFields(Y.encodeStateAsUpdate(writer), "Same\n", "Plan");
    const { hook, doc } = await open("notes/state-race-merge.md");
    body.insert(4, " again");
    vi.unstubAllGlobals();
    stubTextFields(Y.encodeStateAsUpdate(writer), "Same again and more\n", "Plan", {
      stateTag: '"text-2"',
      textTag: '"text-3"',
    });

    await act(async () => {
      await hook.result.current.mergeServerState("token");
    });

    expect(bodyText(doc)).toBe("Same again");
    expect(hook.result.current.refs.localDirtySinceLastSaveRef.current).toBe(false);
    expect(hook.result.current.refs.externalWriteHoldRef.current).toBe(false);
    close(hook);
    writer.destroy();
  });

  it("still applies the state on a reconnect merge when the text cannot be read", async () => {
    const writer = new Y.Doc();
    const body = writeBody(writer, "Same");
    writeNoteTitle(writer, "Plan");
    stubTextFields(Y.encodeStateAsUpdate(writer), "Same\n", "Plan");
    const { hook, doc } = await open("notes/state-text-fails.md");
    body.insert(4, " again");
    vi.unstubAllGlobals();
    stubTextFields(Y.encodeStateAsUpdate(writer), "", "Plan", { textFails: true });

    let merged = false;
    await act(async () => {
      merged = await hook.result.current.mergeServerState("token");
    });

    expect(merged).toBe(true);
    expect(bodyText(doc)).toBe("Same again");
    close(hook);
    writer.destroy();
  });

  it("does not adopt another text on a reconnect merge either", async () => {
    const writer = new Y.Doc();
    const body = writeBody(writer, "Same");
    writeNoteTitle(writer, "Plan");
    stubTextFields(Y.encodeStateAsUpdate(writer), "Same\n", "Plan");
    const { hook, doc } = await open("notes/state-merge.md");
    // A later save stores bytes that grew from the same state but hold
    // text the server never received.
    body.insert(4, " planted");
    vi.unstubAllGlobals();
    stubTextFields(Y.encodeStateAsUpdate(writer), "Same\n", "Plan");

    await act(async () => {
      await hook.result.current.mergeServerState("token");
    });

    expect(bodyText(doc)).toBe("Same");
    expect(readNoteTitle(doc)).toBe("Plan");
    expect(hook.result.current.refs.localDirtySinceLastSaveRef.current).toBe(true);
    close(hook);
    writer.destroy();
  });
});

/**
 * The text-fields shape (#2208): a title and a plain description, joined
 * through the same session. The server answers `GET …/text` as JSON with
 * `title`, `description` and `objectEtag`, and `?format=yjs` with the state
 * or `204`.
 */
describe("useDocsCollabJoin text-fields shape", () => {
  type Served = { state: Uint8Array | null; flag?: boolean; title: string; description: string };

  function serve(served: Served): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes("format=yjs")) {
          if (!served.state) return new Response(null, { status: 204 });
          return new Response(served.state as unknown as BodyInit, {
            status: 200,
            headers: {
              ETag: '"state-1"',
              "X-Wgw-Content-Tag": '"text-1"',
              ...(served.flag ? { "X-Wgw-External-Write": "1" } : {}),
            },
          });
        }
        return Response.json(
          { title: served.title, description: served.description, objectEtag: '"obj-1"' },
          { headers: { ETag: '"text-1"' } },
        );
      }),
    );
  }

  function stateWith(title: string, description: string): Uint8Array {
    const doc = new Y.Doc();
    seedTextFields(doc, { title, description }, null);
    const update = Y.encodeStateAsUpdate(doc);
    doc.destroy();
    return update;
  }

  async function open(room: string, onExternalWrite?: DocsCollabUrls["onExternalWrite"]) {
    const hook = renderHook(() =>
      useEchoSession("Ada", { room, documentShape: "text-fields", onExternalWrite }),
    );
    await act(async () => {
      await hook.result.current.join();
    });
    await act(async () => {
      await hook.result.current.applyServerBootstrap(
        hook.result.current.refs.joinGenerationRef.current,
        "token",
      );
    });
    const doc = hook.result.current.refs.ydocRef.current;
    if (!doc) throw new Error("expected a joined doc");
    return { hook, doc };
  }

  async function close(
    hook: ReturnType<typeof renderHook<ReturnType<typeof useEchoSession>, unknown>>,
  ): Promise<void> {
    const persistence = hook.result.current.refs.persistenceRef.current;
    await persistence?.whenSynced;
    act(() => {
      hook.result.current.teardown();
    });
    hook.unmount();
    resetDocsCollabMeshLingerForTests();
    vi.unstubAllGlobals();
  }

  it("seeds an empty document from a 204 through the shape, with no editor fragment", async () => {
    serve({ state: null, title: "Groceries", description: "Buy milk" });
    const { hook, doc } = await open("tasks/seed-204");

    expect(readTextFields(doc)).toEqual({ title: "Groceries", description: "Buy milk" });
    expect(doc.share.has("default")).toBe(false);
    expect(isYDocEmpty(doc)).toBe(false);
    expect(hook.result.current.refs.localDirtySinceLastSaveRef.current).toBe(false);
    await close(hook);
  });

  it("does not seed a document restored from IndexedDB again", async () => {
    serve({ state: null, title: "Groceries", description: "Buy milk" });
    const first = await open("tasks/restored");
    const before = Y.encodeStateVector(first.doc);
    await close(first.hook);

    serve({ state: null, title: "Groceries", description: "Buy milk" });
    const second = await open("tasks/restored");
    expect(readTextFields(second.doc)).toEqual({ title: "Groceries", description: "Buy milk" });
    expect(Y.encodeStateVector(second.doc)).toEqual(before);
    expect(second.doc.share.has("default")).toBe(false);
    await close(second.hook);
  });

  it("opens a restored seed as the newer server text on a 204, with nothing to save", async () => {
    serve({ state: null, title: "Groceries", description: "Buy milk" });
    const first = await open("tasks/restored-204");
    await close(first.hook);

    serve({ state: null, title: "Groceries", description: "Buy oat milk" });
    const { hook, doc } = await open("tasks/restored-204");
    expect(readTextFields(doc)).toEqual({ title: "Groceries", description: "Buy oat milk" });
    expect(hook.result.current.refs.localDirtySinceLastSaveRef.current).toBe(false);
    await close(hook);
  });

  it("adopts a state that holds the served text, not dirty", async () => {
    serve({
      state: stateWith("Groceries", "Buy milk"),
      title: "Groceries",
      description: "Buy milk",
    });
    const { hook, doc } = await open("tasks/state-matches");
    expect(readTextFields(doc)).toEqual({ title: "Groceries", description: "Buy milk" });
    expect(hook.result.current.refs.localDirtySinceLastSaveRef.current).toBe(false);
    await close(hook);
  });

  it("reseeds from the text when the state holds another description or title", async () => {
    for (const [room, state] of [
      ["tasks/other-description", stateWith("Groceries", "Planted")],
      ["tasks/other-title", stateWith("Planted", "Buy milk")],
    ] as const) {
      serve({ state, title: "Groceries", description: "Buy milk" });
      const { hook, doc } = await open(room);
      expect(readTextFields(doc)).toEqual({ title: "Groceries", description: "Buy milk" });
      await close(hook);
    }
  });

  it("reseeds from the text over six garbage bytes", async () => {
    serve({
      state: new Uint8Array([0xff, 0x13, 0x07, 0x01, 0x02, 0x99]),
      title: "Groceries",
      description: "Buy milk",
    });
    const { hook, doc } = await open("tasks/garbage");
    expect(readTextFields(doc)).toEqual({ title: "Groceries", description: "Buy milk" });
    await close(hook);
  });

  it("reseeds on a reconnect merge of a descendant state with planted text", async () => {
    const writer = new Y.Doc();
    seedTextFields(writer, { title: "Groceries", description: "Buy milk" }, null);
    serve({ state: Y.encodeStateAsUpdate(writer), title: "Groceries", description: "Buy milk" });
    const { hook, doc } = await open("tasks/planted-merge");
    writer.getText(TEXT_FIELDS_BODY).insert(0, "Planted ");
    serve({ state: Y.encodeStateAsUpdate(writer), title: "Groceries", description: "Buy milk" });

    await act(async () => {
      await hook.result.current.mergeServerState("token");
    });

    expect(readTextFields(doc)).toEqual({ title: "Groceries", description: "Buy milk" });
    expect(hook.result.current.refs.localDirtySinceLastSaveRef.current).toBe(false);
    await close(hook);
    writer.destroy();
  });

  it("replaces an outside write quietly on a re-read, publishing nothing to save", async () => {
    serve({ state: null, title: "Groceries", description: "Buy milk" });
    const { hook, doc } = await open("tasks/quiet-replace");
    serve({ state: null, title: "Groceries", description: "Buy soy milk" });

    await act(async () => {
      await hook.result.current.mergeServerState("token");
    });

    expect(readTextFields(doc).description).toBe("Buy soy milk");
    expect(hook.result.current.refs.localDirtySinceLastSaveRef.current).toBe(false);
    await close(hook);
  });

  it("asks, and keeps the document, when this person typed before the outside write", async () => {
    const onExternalWrite = vi.fn();
    serve({ state: null, title: "Groceries", description: "Buy milk" });
    const { hook, doc } = await open("tasks/own-work", onExternalWrite);
    act(() => {
      doc.getText(TEXT_FIELDS_BODY).insert(8, "!");
    });
    serve({ state: null, title: "Groceries", description: "Buy oat milk" });

    await act(async () => {
      await hook.result.current.mergeServerState("token");
    });

    expect(readTextFields(doc).description).toBe("Buy milk!");
    expect(onExternalWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        markdown: "Buy oat milk",
        title: "Groceries",
        objectEtag: '"obj-1"',
      }),
    );
    expect(hook.result.current.refs.externalWriteHoldRef.current).toBe(true);
    await close(hook);
  });

  it("marks typing in the title as local work", async () => {
    serve({ state: null, title: "Groceries", description: "Buy milk" });
    const { hook, doc } = await open("tasks/title-typing");
    act(() => {
      doc.getText(TEXT_FIELDS_TITLE).insert(9, "!");
    });
    expect(hook.result.current.refs.localDirtySinceLastSaveRef.current).toBe(true);
    await close(hook);
  });
});
