/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { setDocsSyncConflictListener } from "@/lib/offline/docs/docs-sync-conflicts";
import { decodeFramedPayload } from "@/lib/wire/framed-payload";
import { loadBootstrapInParallel } from "./docs-collab-bootstrap";
import {
  rememberSidecarEtag,
  resetSidecarEtagsForTests,
  sidecarPrecondition,
} from "./docs-collab-etag";
import { applyContentSeedToYDoc, readContentFromYDoc } from "./docs-collab-editor-surface";
import {
  decideExternalWrite,
  EXTERNAL_WRITE_HEADER,
  replaceDocumentWithExternalText,
} from "./docs-collab-external-write";
import { persistCollabSave } from "./docs-collab-save-attempt";
import {
  fetchYjsSnapshot,
  loadCollabText,
  loadMarkdown,
  loadYjsSnapshot,
  saveDocument,
} from "./docs-collab-server-io";
import type { DocsCollabUrls } from "./docs-collab-types";
import { isExternalWriteRefusal, SERVER_ORIGIN } from "./docs-collab-utils";

/**
 * One scenario table for Notes and Docs. The fake server is the same kind of
 * stand-in as `docs-collab-concurrent-save.test.ts`: ETag, If-Match,
 * If-None-Match, 412, 428, 409 `external_write`, and `X-Wgw-External-Write`.
 * No real backend. The table has no per-app branch. This suite does not
 * replace the existing `docs-collab-*` tests.
 */
type StoredDocument = {
  markdown: string;
  yjs: Uint8Array | null;
};

type CollabApp = {
  name: string;
  /** Creates an empty document on the fake server and returns the urls. */
  createDocument(): Promise<{ id: string; urls: DocsCollabUrls }>;
  /** Reads what is stored on the server, independent of the client. */
  readStored(id: string): Promise<StoredDocument>;
  /** Writes the text from outside the app, the way a CalDAV or WebDAV client would. */
  writeExternally(id: string, markdown: string): Promise<void>;
};

/**
 * `savedMarkdown` is the text the last collab save linked the state to.
 * `textRevision` names the text representation's entity tag.
 */
type ServerDocument = StoredDocument & {
  revision: number;
  savedMarkdown: string;
  textRevision: number;
};

type UrlMatch = { id: string; yjs: boolean } | null;

function etagFor(document: ServerDocument): string | null {
  return document.yjs ? `"rev-${document.revision}"` : null;
}

function readFramedSave(body: BodyInit | null | undefined): {
  markdown?: string;
  yjs?: Uint8Array;
} {
  const bytes =
    body instanceof Uint8Array ? body : body instanceof ArrayBuffer ? new Uint8Array(body) : null;
  if (!bytes) return {};
  const framed = decodeFramedPayload(bytes);
  if (
    !framed ||
    !framed.header ||
    typeof framed.header !== "object" ||
    Array.isArray(framed.header)
  ) {
    return {};
  }
  const lengths = framed.header as { documentLen?: number | null; yjsLen?: number | null };
  let offset = 0;
  let markdown: string | undefined;
  if (typeof lengths.documentLen === "number") {
    markdown = new TextDecoder().decode(framed.tail.subarray(offset, offset + lengths.documentLen));
    offset += lengths.documentLen;
  }
  const yjs =
    typeof lengths.yjsLen === "number"
      ? framed.tail.subarray(offset, offset + lengths.yjsLen)
      : undefined;
  return { markdown, yjs };
}

function header(init: RequestInit | undefined, name: string): string | undefined {
  const headers = init?.headers;
  if (!headers || headers instanceof Headers || Array.isArray(headers)) return undefined;
  return headers[name];
}

/**
 * Contract C7, shared by both adapters. Only the URL and the markdown body
 * differ, and those stay inside the adapter.
 */
function textEtagFor(document: ServerDocument): string {
  return `"text-${document.textRevision}"`;
}

function createCollabFakeServer(options: {
  match(url: string): UrlMatch;
  markdownResponse(markdown: string, etag: string): Response;
}) {
  const documents = new Map<string, ServerDocument>();

  const handle = async (url: string, init?: RequestInit): Promise<Response> => {
    const matched = options.match(url);
    if (!matched) return new Response("not found", { status: 404 });
    const document = documents.get(matched.id);
    if (!document) return new Response("not found", { status: 404 });

    const method = init?.method ?? "GET";
    if (method === "GET" && matched.yjs) {
      if (!document.yjs) return new Response(null, { status: 204 });
      const headers: Record<string, string> = { ETag: etagFor(document)! };
      if (document.markdown !== document.savedMarkdown) headers[EXTERNAL_WRITE_HEADER] = "1";
      return new Response(document.yjs as unknown as BodyInit, { status: 200, headers });
    }
    if (method === "GET") return options.markdownResponse(document.markdown, textEtagFor(document));
    if (method !== "PUT") return new Response("method not allowed", { status: 405 });

    const body = readFramedSave(init?.body);
    const ifMatch = header(init, "If-Match");
    const ifNoneMatch = header(init, "If-None-Match");
    const current = etagFor(document);
    if (body.yjs && ifMatch === undefined && ifNoneMatch === undefined && current !== null) {
      return new Response(JSON.stringify({ error: "precondition_required" }), { status: 428 });
    }
    const refused =
      (ifMatch !== undefined && ifMatch !== current) || (ifNoneMatch === "*" && current !== null);
    if (refused) {
      return new Response(JSON.stringify({ error: "precondition_failed" }), { status: 412 });
    }
    const unseenExternalWrite =
      document.yjs !== null &&
      document.markdown !== document.savedMarkdown &&
      header(init, EXTERNAL_WRITE_HEADER) !== textEtagFor(document);
    if (unseenExternalWrite) {
      return new Response(JSON.stringify({ error: "external_write" }), { status: 409 });
    }

    if (body.yjs) {
      document.yjs = body.yjs.slice();
      document.revision += 1;
    }
    if (typeof body.markdown === "string") {
      document.markdown = body.markdown;
      document.savedMarkdown = body.markdown;
      document.textRevision += 1;
    }
    return new Response("{}", { status: 200, headers: { ETag: etagFor(document)! } });
  };

  return {
    handle,
    create(id: string): void {
      documents.set(id, {
        markdown: "",
        yjs: null,
        revision: 0,
        savedMarkdown: "",
        textRevision: 0,
      });
    },
    read(id: string): StoredDocument {
      const document = documents.get(id);
      if (!document) throw new Error(`missing document ${id}`);
      return {
        markdown: document.markdown,
        yjs: document.yjs ? document.yjs.slice() : null,
      };
    },
    /** The text changes; the stored state and its tag do not. */
    writeExternal(id: string, markdown: string): void {
      const document = documents.get(id);
      if (!document) throw new Error(`missing document ${id}`);
      document.markdown = markdown;
      document.textRevision += 1;
    },
  };
}

function installFetch(handle: (url: string, init?: RequestInit) => Promise<Response>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handle(String(input), init)),
  );
}

function collabUrls(
  fields: Pick<DocsCollabUrls, "documentUrl" | "yjsUrl" | "room">,
): DocsCollabUrls {
  return {
    signalUrl: "/api/v1/rooms/conformance/events",
    collabApiBaseUrl: "/api/v1/rooms",
    collabRtcUrl: "/api/v1/rooms/conformance/configuration",
    ...fields,
  };
}

function createDocsCollabApp(): CollabApp {
  let sequence = 0;
  const server = createCollabFakeServer({
    match(url) {
      const parsed = new URL(url, "http://collab.local");
      if (parsed.pathname !== "/api/v1/files/collaboration") return null;
      const id = parsed.searchParams.get("path");
      if (!id) return null;
      return { id, yjs: parsed.searchParams.get("format") === "yjs" };
    },
    markdownResponse(markdown, etag) {
      return new Response(markdown, {
        status: 200,
        headers: { "Content-Type": "text/markdown", ETag: etag },
      });
    },
  });
  installFetch(server.handle);

  return {
    name: "docs",
    async createDocument() {
      sequence += 1;
      const id = `docs/conformance-${sequence}.md`;
      server.create(id);
      const path = encodeURIComponent(id);
      const documentUrl = `/api/v1/files/collaboration?path=${path}`;
      return {
        id,
        urls: collabUrls({
          documentUrl,
          yjsUrl: `${documentUrl}&format=yjs`,
          room: id,
        }),
      };
    },
    async readStored(id) {
      return server.read(id);
    },
    async writeExternally(id, markdown) {
      server.writeExternal(id, markdown);
    },
  };
}

function createNotesCollabApp(): CollabApp {
  let sequence = 0;
  const server = createCollabFakeServer({
    match(url) {
      const parsed = new URL(url, "http://collab.local");
      const prefix = "/api/v1/notes/items/";
      if (!parsed.pathname.startsWith(prefix)) return null;
      const id = decodeURIComponent(parsed.pathname.slice(prefix.length));
      if (!id) return null;
      return { id, yjs: parsed.searchParams.get("format") === "yjs" };
    },
    markdownResponse(markdown, etag) {
      // The journal ETag moves with tags too; the content tag names the text.
      return new Response(JSON.stringify({ body: markdown, contentEtag: etag }), {
        status: 200,
        headers: { "Content-Type": "application/json", ETag: `"journal-${etag}"` },
      });
    },
  });
  installFetch(server.handle);

  return {
    name: "notes",
    async createDocument() {
      sequence += 1;
      const id = `note-${sequence}`;
      server.create(id);
      const documentUrl = `/api/v1/notes/items/${encodeURIComponent(id)}`;
      return {
        id,
        urls: collabUrls({
          documentUrl,
          yjsUrl: `${documentUrl}?format=yjs`,
          room: id,
        }),
      };
    },
    async readStored(id) {
      return server.read(id);
    },
    async writeExternally(id, markdown) {
      server.writeExternal(id, markdown);
    },
  };
}

const appFactories: Array<{ name: string; create: () => CollabApp }> = [
  { name: "docs", create: createDocsCollabApp },
  { name: "notes", create: createNotesCollabApp },
];

function requireRoom(urls: DocsCollabUrls): string {
  if (!urls.room) throw new Error("collab urls are missing a room");
  return urls.room;
}

function paragraph(text: string): Y.XmlElement {
  const node = new Y.XmlElement("paragraph");
  node.insert(0, [new Y.XmlText(text)]);
  return node;
}

function edit(ydoc: Y.Doc, text: string): void {
  const fragment = ydoc.getXmlFragment("default");
  fragment.insert(fragment.length, [paragraph(text)]);
}

function fragmentText(yjs: Uint8Array | null): string {
  if (!yjs) return "";
  const doc = new Y.Doc();
  Y.applyUpdate(doc, yjs);
  return doc.getXmlFragment("default").toString();
}

type PutCall = { ifMatch?: string; ifNoneMatch?: string };

function documentPuts(documentUrl: string): PutCall[] {
  return vi.mocked(fetch).mock.calls.flatMap(([input, init]) => {
    if (String(input) !== documentUrl || (init?.method ?? "GET") !== "PUT") return [];
    return [{ ifMatch: header(init, "If-Match"), ifNoneMatch: header(init, "If-None-Match") }];
  });
}

async function openClient(urls: DocsCollabUrls): Promise<Y.Doc> {
  const ydoc = new Y.Doc();
  const loaded = await loadYjsSnapshot(urls.yjsUrl, ydoc, undefined, SERVER_ORIGIN);
  rememberSidecarEtag(requireRoom(urls), loaded.etag);
  return ydoc;
}

function save(
  urls: DocsCollabUrls,
  ydoc: Y.Doc,
  markdown: string,
  externalWriteSeen: string | null = null,
) {
  return persistCollabSave({
    urls,
    room: requireRoom(urls),
    ydoc,
    markdown,
    remergeAttempted: { current: false },
    markdownAfterMerge: () => markdown,
    externalWriteSeen,
  });
}

type Scenario = {
  name: string;
  run(app: CollabApp): Promise<void>;
};

/** Sentence two clients seed when the server has no Yjs state (#1089). */
const UNSIDECARRED_MARKER = "must survive exactly once";

const scenarios: Scenario[] = [
  {
    name: "two devices, both edited offline, come back online",
    async run(app) {
      const listener = vi.fn();
      setDocsSyncConflictListener(listener);
      const { id, urls } = await app.createDocument();
      const first = await openClient(urls);
      const second = await openClient(urls);
      edit(first, "device one");
      await save(urls, first, "device one");

      // The second device still holds the pre-save view of the sidecar.
      resetSidecarEtagsForTests();
      rememberSidecarEtag(requireRoom(urls), null);
      edit(second, "device two");
      await save(urls, second, "device two");

      const text = fragmentText((await app.readStored(id)).yjs);
      expect(text).toContain("device one");
      expect(text).toContain("device two");
      expect(listener).not.toHaveBeenCalled();
    },
  },
  {
    name: "a save gets 412",
    async run(app) {
      const { id, urls } = await app.createDocument();
      const author = await openClient(urls);
      edit(author, "base");
      await save(urls, author, "base");
      const stale = sidecarPrecondition(requireRoom(urls));
      expect(stale?.name).toBe("If-Match");
      const base = await app.readStored(id);

      edit(author, "author again");
      await save(urls, author, "author again");

      const peer = new Y.Doc();
      Y.applyUpdate(peer, base.yjs!);
      edit(peer, "peer edit");
      rememberSidecarEtag(requireRoom(urls), stale!.value);
      const putsBefore = documentPuts(urls.documentUrl).length;
      await save(urls, peer, "peer edit");

      const puts = documentPuts(urls.documentUrl).slice(putsBefore);
      expect(puts).toHaveLength(2);
      expect(puts[0]?.ifMatch).toBe(stale!.value);
      expect(puts[1]?.ifMatch).toBeDefined();
      expect(puts[1]?.ifMatch).not.toBe(stale!.value);
      const text = fragmentText((await app.readStored(id)).yjs);
      expect(text).toContain("base");
      expect(text).toContain("author again");
      expect(text).toContain("peer edit");
    },
  },
  {
    name: "a save with no precondition on an existing document",
    async run(app) {
      const { id, urls } = await app.createDocument();
      const author = await openClient(urls);
      edit(author, "existing");
      await save(urls, author, "existing");
      const before = await app.readStored(id);

      resetSidecarEtagsForTests();
      const blind = new Y.Doc();
      edit(blind, "blind overwrite");
      const room = requireRoom(urls);
      await expect(
        saveDocument(
          urls.documentUrl,
          "blind overwrite",
          blind,
          undefined,
          sidecarPrecondition(room),
        ),
      ).rejects.toMatchObject({ status: 428 });

      const last = documentPuts(urls.documentUrl).at(-1);
      expect(last?.ifMatch).toBeUndefined();
      expect(last?.ifNoneMatch).toBeUndefined();
      expect(await app.readStored(id)).toEqual(before);
    },
  },
  {
    name: "a reconnect with a save waiting",
    async run(app) {
      // The reconnect hook writes a save that was waiting. Mesh and IndexedDB
      // stay in their own suites; this row is that client-to-server write.
      const { id, urls } = await app.createDocument();
      const client = await openClient(urls);
      edit(client, "edited while offline");
      expect(documentPuts(urls.documentUrl)).toEqual([]);
      expect((await app.readStored(id)).yjs).toBeNull();

      await save(urls, client, "edited while offline");

      expect(documentPuts(urls.documentUrl)).toHaveLength(1);
      const stored = await app.readStored(id);
      expect(stored.markdown).toBe("edited while offline");
      expect(fragmentText(stored.yjs)).toContain("edited while offline");
    },
  },
  {
    name: "a document that has no server id yet",
    async run(app) {
      const { id, urls } = await app.createDocument();
      const client = new Y.Doc();
      edit(client, "local only");
      const result = await save({ ...urls, roomNotPersistent: true }, client, "local only");

      expect(result.status).toBe("skipped");
      expect(documentPuts(urls.documentUrl)).toEqual([]);
      const stored = await app.readStored(id);
      expect(stored.markdown).toBe("");
      expect(stored.yjs).toBeNull();
    },
  },
  {
    name: "a bootstrap where the server state is missing",
    async run(app) {
      const markdown = `One paragraph that ${UNSIDECARRED_MARKER}.`;
      const { id, urls } = await app.createDocument();
      expect((await app.readStored(id)).yjs).toBeNull();

      const load = await loadBootstrapInParallel({
        loadMarkdown: () => loadMarkdown(urls.documentUrl),
        fetchSnapshot: () => fetchYjsSnapshot(urls.yjsUrl),
        sleep: async () => undefined,
        retryDelaysMs: [],
      });
      expect(load.snapshot.kind).toBe("absent");

      const first = new Y.Doc();
      const second = new Y.Doc();
      applyContentSeedToYDoc(first, markdown, "markdown");
      applyContentSeedToYDoc(second, markdown, "markdown");
      rememberSidecarEtag(requireRoom(urls), null);
      await save(urls, first, markdown);

      // The second client still holds the pre-save view: no sidecar yet.
      resetSidecarEtagsForTests();
      rememberSidecarEtag(requireRoom(urls), null);
      await save(urls, second, markdown);

      const stored = await app.readStored(id);
      const settled = new Y.Doc();
      Y.applyUpdate(settled, stored.yjs!);
      const text = readContentFromYDoc(settled, "markdown");
      expect(text.split(UNSIDECARRED_MARKER).length - 1).toBe(1);
    },
  },
  {
    name: "an external writer changes the content",
    async run(app) {
      const { id, urls } = await app.createDocument();
      const room = requireRoom(urls);
      const author = await openClient(urls);
      edit(author, "saved in the app");
      await save(urls, author, "saved in the app");
      const stateBefore = (await app.readStored(id)).yjs;

      await app.writeExternally(id, "Written outside the app.");

      const flagged = await fetchYjsSnapshot(urls.yjsUrl);
      expect(flagged.externalWrite).toBe(true);
      expect((await app.readStored(id)).yjs).toEqual(stateBefore);
      // With unsaved work the person is asked and nothing is written yet.
      const putsBefore = documentPuts(urls.documentUrl).length;
      expect(decideExternalWrite(true, true)).toBe("prompt");
      expect(documentPuts(urls.documentUrl)).toHaveLength(putsBefore);

      // Without it, the document is rebuilt from the outside text and saved.
      expect(decideExternalWrite(true, false)).toBe("rebuild");
      const text = await loadCollabText(urls.documentUrl);
      const rebuilt = new Y.Doc();
      replaceDocumentWithExternalText(
        rebuilt,
        text.markdown,
        text.title,
        "markdown",
        Y.encodeStateVectorFromUpdate(flagged.update!),
      );
      rememberSidecarEtag(room, flagged.etag);
      // The rebuild saw the outside text, so its save names it.
      await save(urls, rebuilt, text.markdown, text.etag ?? null);

      const stored = await app.readStored(id);
      expect(stored.markdown).toBe("Written outside the app.");
      const settled = new Y.Doc();
      Y.applyUpdate(settled, stored.yjs!);
      expect(readContentFromYDoc(settled, "markdown")).toContain("Written outside the app.");
      expect((await fetchYjsSnapshot(urls.yjsUrl)).externalWrite).toBe(false);
    },
  },
  {
    name: "an external writer changes the content while the document is open",
    async run(app) {
      const listener = vi.fn();
      setDocsSyncConflictListener(listener);
      const { id, urls } = await app.createDocument();
      const author = await openClient(urls);
      edit(author, "saved in the app");
      await save(urls, author, "saved in the app");

      await app.writeExternally(id, "Written outside the app.");
      // The sidecar tag this client holds is still current.
      edit(author, "typed while it was open");
      const refusal = await save(urls, author, "typed while it was open").catch(
        (error: unknown) => error,
      );
      expect(isExternalWriteRefusal(refusal)).toBe(true);
      expect((await app.readStored(id)).markdown).toBe("Written outside the app.");
      expect(listener).not.toHaveBeenCalled();

      // After the person saw the outside text and kept their edits.
      const seen = await loadCollabText(urls.documentUrl);
      await save(urls, author, "typed while it was open", seen.etag ?? null);
      expect((await app.readStored(id)).markdown).toBe("typed while it was open");
      expect((await fetchYjsSnapshot(urls.yjsUrl)).externalWrite).toBe(false);
    },
  },
];

describe.each(appFactories)("collab app conformance ($name)", ({ create }) => {
  let app: CollabApp;

  beforeEach(() => {
    resetSidecarEtagsForTests();
    setDocsSyncConflictListener(undefined);
    // The shared save only remerges while the client is online.
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    app = create();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetSidecarEtagsForTests();
    setDocsSyncConflictListener(undefined);
  });

  for (const scenario of scenarios) {
    it(scenario.name, () => scenario.run(app));
  }
});
