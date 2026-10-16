/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import { resetConnectivityHubForTests } from "@/lib/offline/browser-online";
import { decodeFramedPayload } from "@/lib/wire/framed-payload";
import { resetDocsCollabBackoffForTests } from "./docs-collab-room-backoff";
import { clearDocsCollabSyncState } from "./docs-collab-sync-registry";
import { rememberSidecarEtag, resetSidecarEtagsForTests } from "./docs-collab-etag";
import type { DocsCollabUrls } from "./docs-collab-types";
import { useDocsCollabSave } from "./use-docs-collab-save";
import { useDocsCollabSessionRefs } from "./use-docs-collab-session-refs";
import { useDocsConflictResolution } from "./use-docs-conflict-resolution";
import { DEFAULT_DOCS_COLLAB_WIRE } from "./docs-collab-wire";

/**
 * Pins the Keep-mine branches of the Docs conflict dialog (#1364).
 * `useDocsConflictResolution.keepLocal` runs the real `saveNow` from
 * `useDocsCollabSave`, which calls `persistCollabSave`. Assertions record the
 * current outcome. A comment marks a branch whose outcome is wrong, so a later
 * fix flips that assertion.
 */

const ROOM = "docs/keep-local.md";
const DOCUMENT_URL = "/api/v1/files/collaboration?path=docs%2Fkeep-local.md";
const YJS_URL = `${DOCUMENT_URL}&format=yjs`;
const URLS: DocsCollabUrls = {
  signalUrl: "/api/v1/rooms/keep-local/events",
  collabApiBaseUrl: "/api/v1/rooms",
  collabRtcUrl: "/api/v1/rooms/keep-local/configuration",
  documentUrl: DOCUMENT_URL,
  yjsUrl: YJS_URL,
  room: ROOM,
};

const STALE_ETAG = '"rev-stale"';
const LOCAL = "kept local text";
const SERVER = "server text";

type SnapshotMode = "serve" | "status";

type PutRecord = {
  ifMatch?: string;
  ifNoneMatch?: string;
  markdown?: string;
  status: number;
};

type FakeDocument = {
  markdown: string;
  yjs: Uint8Array | null;
  revision: number;
  snapshotMode: SnapshotMode;
  snapshotStatus: number;
};

function etagFor(document: FakeDocument): string | null {
  return document.yjs ? `"rev-${document.revision}"` : null;
}

function headerValue(init: RequestInit | undefined, name: string): string | undefined {
  const headers = init?.headers;
  if (!headers) return undefined;
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  if (Array.isArray(headers)) {
    const found = headers.find(([key]) => key.toLowerCase() === name.toLowerCase());
    return found?.[1];
  }
  return (headers as Record<string, string>)[name];
}

function readFramedMarkdown(body: BodyInit | null | undefined): string | undefined {
  const bytes =
    body instanceof Uint8Array ? body : body instanceof ArrayBuffer ? new Uint8Array(body) : null;
  if (!bytes) return undefined;
  const framed = decodeFramedPayload(bytes);
  if (!framed?.header || typeof framed.header !== "object" || Array.isArray(framed.header)) {
    return undefined;
  }
  const documentLen = (framed.header as { documentLen?: unknown }).documentLen;
  if (typeof documentLen !== "number") return undefined;
  return new TextDecoder().decode(framed.tail.subarray(0, documentLen));
}

function createFakeServer(initial: Partial<FakeDocument> = {}) {
  const document: FakeDocument = {
    markdown: "",
    yjs: null,
    revision: 0,
    snapshotMode: "serve",
    snapshotStatus: 204,
    ...initial,
  };
  const puts: PutRecord[] = [];

  const handle = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (method === "GET" && url.includes("format=yjs")) {
      if (document.snapshotMode === "status") {
        return new Response(JSON.stringify({ error: "precondition_failed" }), {
          status: document.snapshotStatus,
        });
      }
      if (!document.yjs) return new Response(null, { status: 204 });
      return new Response(document.yjs as unknown as BodyInit, {
        status: 200,
        headers: { ETag: etagFor(document)! },
      });
    }
    if (method === "GET") {
      return new Response(document.markdown, {
        status: 200,
        headers: { "Content-Type": "text/markdown" },
      });
    }
    if (method !== "PUT") return new Response("not found", { status: 404 });

    const markdown = readFramedMarkdown(init?.body);
    const ifMatch = headerValue(init, "If-Match");
    const ifNoneMatch = headerValue(init, "If-None-Match");
    const current = etagFor(document);
    const refused =
      (ifMatch !== undefined && ifMatch !== current) || (ifNoneMatch === "*" && current !== null);
    const status = refused ? 412 : 200;
    puts.push({ ifMatch, ifNoneMatch, markdown, status });
    if (refused) {
      return new Response(JSON.stringify({ error: "precondition_failed" }), { status: 412 });
    }
    const yjs = readFramedYjs(init?.body);
    if (yjs) {
      document.yjs = yjs;
      document.revision += 1;
    }
    if (typeof markdown === "string") document.markdown = markdown;
    const savedEtag = etagFor(document);
    return new Response("{}", {
      status: 200,
      headers: savedEtag ? { ETag: savedEtag } : {},
    });
  };

  return { document, puts, handle };
}

function readFramedYjs(body: BodyInit | null | undefined): Uint8Array | null {
  const bytes =
    body instanceof Uint8Array ? body : body instanceof ArrayBuffer ? new Uint8Array(body) : null;
  if (!bytes) return null;
  const framed = decodeFramedPayload(bytes);
  if (!framed?.header || typeof framed.header !== "object" || Array.isArray(framed.header)) {
    return null;
  }
  const lengths = framed.header as { documentLen?: unknown; yjsLen?: unknown };
  if (typeof lengths.yjsLen !== "number") return null;
  const documentLen = typeof lengths.documentLen === "number" ? lengths.documentLen : 0;
  return framed.tail.subarray(documentLen, documentLen + lengths.yjsLen).slice();
}

type Harness = {
  saveNow: () => Promise<void>;
  onMarkdownChange: (getMarkdown: () => string) => void;
  conflict: ReturnType<typeof useDocsConflictResolution>;
  /** Dirty flag the save queue still holds. */
  localDirty: () => boolean;
};

function useKeepLocalHarness(markdown: { current: string }): Harness {
  const refs = useDocsCollabSessionRefs(DEFAULT_DOCS_COLLAB_WIRE, undefined);
  const ydocHolder = useRef<Y.Doc | null>(null);
  if (!ydocHolder.current) ydocHolder.current = new Y.Doc();
  refs.ydocRef.current = ydocHolder.current;
  refs.getMarkdownRef.current = () => markdown.current;
  if (!refs.persistenceRef.current) {
    refs.persistenceRef.current = {
      set: async () => undefined,
      del: async () => undefined,
      get: async () => undefined,
    } as unknown as IndexeddbPersistence;
  }

  const [, setDocStatus] = useState("");
  const [, setLastSavedAt] = useState<string | null>(null);
  const [, setPendingSync] = useState(false);
  const [, setFailedSync] = useState(false);
  const save = useDocsCollabSave({
    refs,
    room: ROOM,
    urls: URLS,
    setDocStatus,
    setLastSavedAt,
    setPendingSync,
    setFailedSync,
  });
  const conflict = useDocsConflictResolution({
    room: ROOM,
    ydoc: ydocHolder.current,
    yjsUrl: URLS.yjsUrl,
    authToken: undefined,
    saveNow: save.saveNow,
    onServerApplied: () => undefined,
  });

  return {
    saveNow: save.saveNow,
    onMarkdownChange: save.onMarkdownChange,
    conflict,
    localDirty: () => refs.localDirtySinceLastSaveRef.current,
  };
}

function markEdited(
  result: { current: Harness },
  markdown: { current: string },
  text: string,
): void {
  markdown.current = text;
  act(() => {
    result.current.onMarkdownChange(() => markdown.current);
  });
}

async function saveUntilConflict(result: { current: Harness }): Promise<void> {
  await act(async () => {
    await result.current.saveNow().catch(() => undefined);
  });
  await waitFor(() => expect(result.current.conflict.open).toBe(true));
}

async function trackRejections(body: () => Promise<void>): Promise<unknown[]> {
  const reasons: unknown[] = [];
  const onRejection = (reason: unknown) => {
    reasons.push(reason);
  };
  process.on("unhandledRejection", onRejection);
  try {
    await body();
    await new Promise((resolve) => setTimeout(resolve, 20));
    return reasons.slice();
  } finally {
    process.off("unhandledRejection", onRejection);
  }
}

describe("Docs conflict Keep mine", () => {
  const markdown = { current: LOCAL };

  beforeEach(() => {
    markdown.current = LOCAL;
    resetSidecarEtagsForTests();
    resetDocsCollabBackoffForTests();
    clearDocsCollabSyncState(ROOM);
    resetConnectivityHubForTests();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  });

  afterEach(() => {
    resetSidecarEtagsForTests();
    resetDocsCollabBackoffForTests();
    clearDocsCollabSyncState(ROOM);
    resetConnectivityHubForTests();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps the dialog open when the remerge threw before the etag was refreshed", async () => {
    // The 412 on GET format=yjs is a stand-in. A correct server never returns
    // 412 on that GET: fetchYjsSnapshot sends no precondition. Realistic
    // remerge failures (500, 503, network) are not divergence errors, so they
    // do not report a conflict and do not open the dialog. The reachable
    // second-412 route — reload succeeded (applied === true) and the etag was
    // refreshed, then the follow-up save gets 412 — is not this test.
    //
    // remergeAttempted is cleared only after a successful remerge. One failure
    // leaves it set for the rest of this document, so Keep mine does not reload.
    const server = createFakeServer({
      markdown: SERVER,
      yjs: new Uint8Array([1]),
      revision: 2,
      snapshotMode: "status",
      snapshotStatus: 412,
    });
    vi.stubGlobal("fetch", vi.fn(server.handle));
    rememberSidecarEtag(ROOM, STALE_ETAG);

    const { result } = renderHook(() => useKeepLocalHarness(markdown));
    markEdited(result, markdown, LOCAL);
    await saveUntilConflict(result);
    expect(server.puts.map((put) => put.ifMatch)).toEqual([STALE_ETAG]);
    expect(server.document.markdown).toBe(SERVER);
    const putsBeforeKeep = server.puts.length;

    const rejections = await trackRejections(async () => {
      act(() => {
        result.current.conflict.keepLocal();
      });
      await waitFor(() => expect(result.current.conflict.busy).toBe(false));
    });

    const kept = server.puts.slice(putsBeforeKeep);
    // Correct outcome: Keep mine writes the local version (a PUT that the
    // server accepts), the dialog closes, the server stores that version, and
    // the promise does not reject. Flip these four assertions when that lands.
    expect(kept).toEqual([
      { ifMatch: STALE_ETAG, ifNoneMatch: undefined, markdown: LOCAL, status: 412 },
    ]);
    expect(result.current.conflict.open).toBe(true);
    expect(server.document.markdown).toBe(SERVER);
    expect(rejections).toHaveLength(1);
    expect(rejections[0]).toMatchObject({ status: 412 });
  });

  it("writes the local version when the snapshot had no update", async () => {
    // No sidecar, so the snapshot load returns 204 (applied === false) after
    // the stale If-Match is refused. rememberSidecarEtag runs with a null etag.
    const server = createFakeServer({ markdown: "", yjs: null, snapshotMode: "serve" });
    vi.stubGlobal("fetch", vi.fn(server.handle));
    rememberSidecarEtag(ROOM, STALE_ETAG);

    const { result } = renderHook(() => useKeepLocalHarness(markdown));
    markEdited(result, markdown, LOCAL);
    await saveUntilConflict(result);
    const putsBeforeKeep = server.puts.length;

    const rejections = await trackRejections(async () => {
      act(() => {
        result.current.conflict.keepLocal();
      });
      await waitFor(() => expect(result.current.conflict.busy).toBe(false));
    });

    const kept = server.puts.slice(putsBeforeKeep);
    // This 204 is "no sidecar". The null etag is sent as If-None-Match: *,
    // and that PUT is accepted because nothing is stored yet. A 0-byte sidecar
    // is the other applied === false case; it is the next test.
    expect(kept).toEqual([{ ifMatch: undefined, ifNoneMatch: "*", markdown: LOCAL, status: 200 }]);
    expect(result.current.conflict.open).toBe(false);
    expect(server.document.markdown).toBe(LOCAL);
    expect(rejections).toEqual([]);
  });

  it("keeps the dialog open when the sidecar body is empty", async () => {
    // 0-byte sidecar: the snapshot GET is 200 with an empty body, so
    // fetchYjsSnapshot reports applied === false and a null etag. Keep mine
    // sends If-None-Match: *. The sidecar still exists, so a correct server
    // rejects that with 412. The dialog stays open and the rejection is unhandled.
    const server = createFakeServer({
      markdown: SERVER,
      yjs: new Uint8Array(0),
      revision: 1,
      snapshotMode: "serve",
    });
    vi.stubGlobal("fetch", vi.fn(server.handle));
    rememberSidecarEtag(ROOM, STALE_ETAG);

    const { result } = renderHook(() => useKeepLocalHarness(markdown));
    markEdited(result, markdown, LOCAL);
    await saveUntilConflict(result);
    const putsBeforeKeep = server.puts.length;

    const rejections = await trackRejections(async () => {
      act(() => {
        result.current.conflict.keepLocal();
      });
      await waitFor(() => expect(result.current.conflict.busy).toBe(false));
    });

    const kept = server.puts.slice(putsBeforeKeep);
    // Correct outcome: Keep mine writes the local version, the dialog closes,
    // the server stores that version, and the promise does not reject. Flip
    // these assertions when that lands.
    expect(kept).toEqual([{ ifMatch: undefined, ifNoneMatch: "*", markdown: LOCAL, status: 412 }]);
    expect(result.current.conflict.open).toBe(true);
    expect(server.document.markdown).toBe(SERVER);
    expect(rejections).toHaveLength(1);
    expect(rejections[0]).toMatchObject({ status: 412 });
  });

  it("closes the dialog without a PUT when the signature matches the last save", async () => {
    const server = createFakeServer({ snapshotMode: "serve" });
    vi.stubGlobal("fetch", vi.fn(server.handle));
    const { result } = renderHook(() => useKeepLocalHarness(markdown));

    markEdited(result, markdown, LOCAL);
    await act(async () => {
      await result.current.saveNow();
    });
    expect(server.document.markdown).toBe(LOCAL);
    expect(result.current.conflict.open).toBe(false);

    server.document.markdown = SERVER;
    server.document.revision += 1;
    server.document.snapshotMode = "status";
    server.document.snapshotStatus = 412;

    markEdited(result, markdown, "unsaved local text");
    await saveUntilConflict(result);
    expect(result.current.conflict.open).toBe(true);

    // Precondition: the editor is back on the last successful save, so the
    // signature matches lastSuccessfulSaveSignature, and the dirty flag is
    // still set. Signature equality alone skips the PUT.
    markdown.current = LOCAL;
    expect(result.current.localDirty()).toBe(true);
    const putsBeforeKeep = server.puts.length;

    const rejections = await trackRejections(async () => {
      act(() => {
        result.current.conflict.keepLocal();
      });
      await waitFor(() => expect(result.current.conflict.busy).toBe(false));
    });

    // Current outcome: the short-circuit clears the dirty flag and writes
    // nothing, while the server still has the other version. Correct outcome:
    // Keep mine PUTs the local version and the server stores it; the dirty
    // flag stays set until that write succeeds. No unhandled rejection
    // (already the case). Flip the empty PUT, the server markdown, and
    // localDirty() below.
    expect(server.puts.slice(putsBeforeKeep)).toEqual([]);
    expect(result.current.conflict.open).toBe(false);
    expect(server.document.markdown).toBe(SERVER);
    expect(result.current.localDirty()).toBe(false);
    expect(rejections).toEqual([]);
  });
});
