import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { loadYjsSnapshot, saveDocument } from "./docs-collab-server-io";
import {
  rememberSidecarEtag,
  resetSidecarEtagsForTests,
  sidecarPrecondition,
} from "./docs-collab-etag";
import { setDocsSyncConflictListener } from "@/lib/offline/docs/docs-sync-conflicts";
import { isServerDivergenceError, SERVER_ORIGIN } from "./docs-collab-utils";

const DOCUMENT_URL = "/api/v1/files/collaboration?path=docs%2Ftogether.md";
const YJS_URL = `${DOCUMENT_URL}&format=yjs`;
const ROOM = "docs/together.md";

/** Minimal C7 server: opaque ETag, If-Match / If-None-Match, 412 and 428. */
function createCollabServer() {
  let sidecar: Uint8Array | null = null;
  let revision = 0;

  const etag = (): string | null => (sidecar ? `"sidecar-rev-${revision}"` : null);

  const fetchStub = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
    const headers = (init?.headers ?? {}) as Record<string, string>;

    if (!init?.method || init.method === "GET") {
      if (!sidecar) return new Response(null, { status: 204 });
      return new Response(sidecar as unknown as BodyInit, {
        status: 200,
        headers: { ETag: etag()! },
      });
    }

    const body = JSON.parse(String(init?.body ?? "{}")) as { yjs?: number[] };
    const ifMatch = headers["If-Match"];
    const ifNoneMatch = headers["If-None-Match"];
    const current = etag();
    if (body.yjs && ifMatch === undefined && ifNoneMatch === undefined && current !== null) {
      return new Response(JSON.stringify({ error: "precondition_required" }), { status: 428 });
    }
    const refused =
      (ifMatch !== undefined && ifMatch !== current) || (ifNoneMatch === "*" && current !== null);
    if (refused) {
      return new Response(JSON.stringify({ error: "precondition_failed" }), { status: 412 });
    }

    if (body.yjs) {
      sidecar = new Uint8Array(body.yjs);
      revision += 1;
    }
    return new Response("{}", { status: 200, headers: { ETag: etag()! } });
  });

  return { fetchStub, getRevision: () => revision };
}

function paragraph(text: string): Y.XmlElement {
  const node = new Y.XmlElement("paragraph");
  node.insert(0, [new Y.XmlText(text)]);
  return node;
}

/** Appends a paragraph the way the editor would, as a local (dirty) change. */
function edit(ydoc: Y.Doc, text: string): void {
  const fragment = ydoc.getXmlFragment("default");
  fragment.insert(fragment.length, [paragraph(text)]);
}

/**
 * The save sequence the collab save hook performs: try once with the known
 * precondition, and on a divergence reload the snapshot, merge, and resave.
 */
async function saveWithRemerge(
  ydoc: Y.Doc,
  markdown: string,
  target: { documentUrl: string; yjsUrl: string; room: string } = {
    documentUrl: DOCUMENT_URL,
    yjsUrl: YJS_URL,
    room: ROOM,
  },
): Promise<void> {
  try {
    const etag = await saveDocument(
      target.documentUrl,
      markdown,
      ydoc,
      target.room,
      undefined,
      sidecarPrecondition(target.room),
    );
    rememberSidecarEtag(target.room, etag);
    return;
  } catch (error) {
    if (!isServerDivergenceError(error)) throw error;
  }

  const reload = await loadYjsSnapshot(target.yjsUrl, ydoc, undefined, SERVER_ORIGIN);
  rememberSidecarEtag(target.room, reload.etag);
  const etag = await saveDocument(
    target.documentUrl,
    markdown,
    ydoc,
    target.room,
    undefined,
    sidecarPrecondition(target.room),
  );
  rememberSidecarEtag(target.room, etag);
}

describe("two clients saving in turn without a live mesh", () => {
  beforeEach(() => {
    resetSidecarEtagsForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps both edits instead of letting the second save win", async () => {
    const server = createCollabServer();
    vi.stubGlobal("fetch", server.fetchStub);

    // Both clients opened the document before either saved, so both believe
    // there is no sidecar yet.
    const first = new Y.Doc();
    const second = new Y.Doc();
    rememberSidecarEtag(ROOM, null);

    edit(first, "first client edit");
    await saveWithRemerge(first, "first client edit");

    // The second client still holds the pre-save view of the sidecar.
    resetSidecarEtagsForTests();
    rememberSidecarEtag(ROOM, null);
    edit(second, "second client edit");
    await saveWithRemerge(second, "second client edit");

    const stored = new Y.Doc();
    const settled = await loadYjsSnapshot(YJS_URL, stored, undefined, SERVER_ORIGIN);

    expect(settled.applied).toBe(true);
    const text = stored.getXmlFragment("default").toString();
    expect(text).toContain("first client edit");
    expect(text).toContain("second client edit");
  });

  it("refuses the blind second save that would have overwritten the first", async () => {
    const server = createCollabServer();
    vi.stubGlobal("fetch", server.fetchStub);

    rememberSidecarEtag(ROOM, null);
    const first = new Y.Doc();
    edit(first, "first client edit");
    await saveWithRemerge(first, "first client edit");

    const second = new Y.Doc();
    edit(second, "second client edit");

    await expect(
      saveDocument(DOCUMENT_URL, "second client edit", second, ROOM, undefined, {
        name: "If-None-Match",
        value: "*",
      }),
    ).rejects.toMatchObject({ status: 412 });
  });

  it("classifies a 412 as a server divergence", () => {
    const error = Object.assign(new Error("precondition_failed"), { status: 412 });

    expect(isServerDivergenceError(error)).toBe(true);
  });

  it("keeps both edits when a header-less save is refused with 428", async () => {
    const server = createCollabServer();
    vi.stubGlobal("fetch", server.fetchStub);

    rememberSidecarEtag(ROOM, null);
    const first = new Y.Doc();
    edit(first, "first client edit");
    await saveWithRemerge(first, "first client edit");

    // No remembered ETag: the save goes out with neither If-Match nor If-None-Match.
    resetSidecarEtagsForTests();
    const second = new Y.Doc();
    edit(second, "second client edit");
    await saveWithRemerge(second, "second client edit");

    const stored = new Y.Doc();
    const settled = await loadYjsSnapshot(YJS_URL, stored, undefined, SERVER_ORIGIN);

    expect(settled.applied).toBe(true);
    const text = stored.getXmlFragment("default").toString();
    expect(text).toContain("first client edit");
    expect(text).toContain("second client edit");
  });

  it("remerges a note save that gets 412 and keeps both edits", async () => {
    const server = createCollabServer();
    vi.stubGlobal("fetch", server.fetchStub);
    const note = {
      documentUrl: "/api/v1/notes/items/note-1",
      yjsUrl: "/api/v1/notes/items/note-1?format=yjs",
      room: "note-1",
    };
    rememberSidecarEtag(note.room, null);

    const first = new Y.Doc();
    const second = new Y.Doc();
    edit(first, "offline note a");
    await saveWithRemerge(first, "offline note a", note);

    resetSidecarEtagsForTests();
    rememberSidecarEtag(note.room, null);
    edit(second, "offline note b");
    await saveWithRemerge(second, "offline note b", note);

    const stored = new Y.Doc();
    const settled = await loadYjsSnapshot(note.yjsUrl, stored, undefined, SERVER_ORIGIN);
    expect(settled.applied).toBe(true);
    const text = stored.getXmlFragment("default").toString();
    expect(text).toContain("offline note a");
    expect(text).toContain("offline note b");
  });

  it("merges two offline note documents without opening a conflict dialog", () => {
    const listener = vi.fn();
    setDocsSyncConflictListener(listener);
    const first = new Y.Doc();
    const second = new Y.Doc();
    edit(first, "offline note a");
    edit(second, "offline note b");

    const merged = new Y.Doc();
    Y.applyUpdate(merged, Y.encodeStateAsUpdate(first));
    Y.applyUpdate(merged, Y.encodeStateAsUpdate(second));

    const text = merged.getXmlFragment("default").toString();
    expect(text).toContain("offline note a");
    expect(text).toContain("offline note b");
    expect(listener).not.toHaveBeenCalled();
    setDocsSyncConflictListener(undefined);
  });
});
