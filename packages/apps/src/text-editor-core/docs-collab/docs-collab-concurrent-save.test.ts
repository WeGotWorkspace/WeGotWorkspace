import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { decodeFramedPayload } from "@/lib/wire/framed-payload";
import { loadYjsSnapshot, saveDocument } from "./docs-collab-server-io";
import {
  rememberSidecarEtag,
  resetSidecarEtagsForTests,
  sidecarPrecondition,
} from "./docs-collab-etag";
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

    const yjs = readFramedYjs(init?.body);
    const ifMatch = headers["If-Match"];
    const ifNoneMatch = headers["If-None-Match"];
    const current = etag();
    if (yjs && ifMatch === undefined && ifNoneMatch === undefined && current !== null) {
      return new Response(JSON.stringify({ error: "precondition_required" }), { status: 428 });
    }
    const refused =
      (ifMatch !== undefined && ifMatch !== current) || (ifNoneMatch === "*" && current !== null);
    if (refused) {
      return new Response(JSON.stringify({ error: "precondition_failed" }), { status: 412 });
    }

    if (yjs) {
      sidecar = yjs;
      revision += 1;
    }
    return new Response("{}", { status: 200, headers: { ETag: etag()! } });
  });

  return { fetchStub, getRevision: () => revision };
}

function readFramedYjs(body: BodyInit | null | undefined): Uint8Array | null {
  const bytes =
    body instanceof Uint8Array ? body : body instanceof ArrayBuffer ? new Uint8Array(body) : null;
  if (!bytes) return null;
  const framed = decodeFramedPayload(bytes);
  if (
    !framed ||
    !framed.header ||
    typeof framed.header !== "object" ||
    Array.isArray(framed.header)
  ) {
    return null;
  }
  const header = framed.header as { documentLen?: number | null; yjsLen?: number | null };
  if (typeof header.yjsLen !== "number") return null;
  const documentLen = typeof header.documentLen === "number" ? header.documentLen : 0;
  return framed.tail.subarray(documentLen, documentLen + header.yjsLen);
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
async function saveWithRemerge(ydoc: Y.Doc, markdown: string): Promise<void> {
  try {
    const etag = await saveDocument(
      DOCUMENT_URL,
      markdown,
      ydoc,
      undefined,
      "PUT",
      sidecarPrecondition(ROOM),
    );
    rememberSidecarEtag(ROOM, etag);
    return;
  } catch (error) {
    if (!isServerDivergenceError(error)) throw error;
  }

  const reload = await loadYjsSnapshot(YJS_URL, ydoc, undefined, SERVER_ORIGIN);
  rememberSidecarEtag(ROOM, reload.etag);
  const etag = await saveDocument(
    DOCUMENT_URL,
    markdown,
    ydoc,
    undefined,
    "PUT",
    sidecarPrecondition(ROOM),
  );
  rememberSidecarEtag(ROOM, etag);
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
      saveDocument(DOCUMENT_URL, "second client edit", second, undefined, "PUT", {
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
});
