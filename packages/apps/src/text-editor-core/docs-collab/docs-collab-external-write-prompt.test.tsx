import "fake-indexeddb/auto";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import { docsLabels } from "@/docs-core/src/docs-labels";
import { resetConnectivityHubForTests } from "@/lib/offline/browser-online";
import { DEFAULT_RTC_SETTINGS } from "@/lib/rtc/types";
import { decodeFramedPayload } from "@/lib/wire/framed-payload";
import { applyContentSeedToYDoc, readContentFromYDoc } from "./docs-collab-editor-surface";
import { resetDocsCollabMeshLingerForTests } from "./docs-collab-mesh-linger";
import { docsCollabIndexedDbKey } from "./docs-collab-persistence";
import type { DocsCollabUrls } from "./docs-collab-types";
import type { DocsCollabWireOperations } from "./docs-collab-wire";
import { DocsConflictDialog } from "./docs-conflict-dialog";
import { PENDING_SERVER_SAVE_KEY } from "./pending-server-save-key";
import {
  DEFAULT_DOCS_COLLAB_URLS,
  resetDocsCollabBackoffForTests,
  useDocsCollab,
} from "./use-docs-collab";
import {
  useDocsExternalWritePrompt,
  useDocsExternalWriteRequest,
} from "./use-docs-external-write-prompt";

vi.mock("./docs-rtc-session", () => ({
  DocsRtcSession: class MockDocsRtcSession {
    join = vi.fn(async () => ({ peers: [] }));
    leave = vi.fn();
    broadcast = vi.fn();
    onMessage = vi.fn();
    getPeerIds = vi.fn(() => []);
    getRoomPeers = vi.fn(() => []);
    linkCount = vi.fn(() => 0);
    getRoomPeerStatuses = vi.fn(() => []);
    getMyId = vi.fn(() => "peer-a");
    getMyName = vi.fn(() => "Alex");
    clearMessageListeners = vi.fn();
    sendTo = vi.fn();
    noteLocalUpdate = vi.fn();
  },
}));

const wire: DocsCollabWireOperations = {
  fetchAuthToken: vi.fn(async () => "test-token"),
  fetchRtcSettings: vi.fn(async () => DEFAULT_RTC_SETTINGS),
};

const OUTSIDE_TEXT = "Written in my own editor.";

function docsUrls(room: string): DocsCollabUrls {
  const documentUrl = `/api/v1/files/collaboration?path=${encodeURIComponent(room)}`;
  return {
    ...DEFAULT_DOCS_COLLAB_URLS,
    room,
    documentUrl,
    yjsUrl: `${documentUrl}&format=yjs`,
  };
}

function staleState(): ArrayBuffer {
  const doc = new Y.Doc();
  doc.getText("stale-marker").insert(0, "stale");
  const update = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  const body = new ArrayBuffer(update.byteLength);
  new Uint8Array(body).set(update);
  return body;
}

/** The Docs server after a WebDAV write: same sidecar, flagged, new text. */
function serveExternalWrite(puts: string[], saveStatus = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes("format=yjs")) {
        return new Response(staleState(), {
          status: 200,
          headers: { ETag: '"sidecar"', "X-Wgw-External-Write": "1" },
        });
      }
      if (method === "PUT") {
        puts.push(markdownFromFramedSave(init?.body));
        if (saveStatus !== 200) return new Response("{}", { status: saveStatus });
        return new Response("{}", { status: 200, headers: { ETag: '"saved"' } });
      }
      return new Response(OUTSIDE_TEXT, {
        status: 200,
        headers: { "Content-Type": "text/markdown" },
      });
    }),
  );
}

const OUTSIDE_TAG = '"outside-text"';

type RefusedPut = { markdown: string; seen: string | undefined };

/**
 * The read is clean: the edit lands while the document is already open.
 * A save that does not name the outside text it saw is refused.
 */
function serveOutsideEditWhileOpen(puts: RefusedPut[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes("format=yjs")) {
        return new Response(staleState(), { status: 200, headers: { ETag: '"sidecar"' } });
      }
      if (method === "PUT") {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        const seen = headers["X-Wgw-External-Write"];
        puts.push({ markdown: markdownFromFramedSave(init?.body), seen });
        if (seen !== OUTSIDE_TAG) {
          return new Response(JSON.stringify({ error: "external_write" }), { status: 409 });
        }
        return new Response("{}", { status: 200, headers: { ETag: '"saved"' } });
      }
      return new Response(OUTSIDE_TEXT, {
        status: 200,
        headers: { "Content-Type": "text/markdown", ETag: OUTSIDE_TAG },
      });
    }),
  );
}

function typeLocally(ydoc: Y.Doc, text: string): void {
  const paragraph = new Y.XmlElement("paragraph");
  paragraph.insert(0, [new Y.XmlText(text)]);
  const fragment = ydoc.getXmlFragment("default");
  fragment.insert(fragment.length, [paragraph]);
}

function markdownFromFramedSave(body: BodyInit | null | undefined): string {
  const bytes = body instanceof Uint8Array ? body : null;
  const framed = bytes ? decodeFramedPayload(bytes) : null;
  const header = framed?.header as { documentLen?: unknown } | undefined;
  if (!framed || typeof header?.documentLen !== "number") return "";
  return new TextDecoder().decode(framed.tail.subarray(0, header.documentLen));
}

const LOCAL_TEXT = "My unsaved draft.";

async function markUnsavedWork(room: string): Promise<void> {
  const local = new Y.Doc();
  applyContentSeedToYDoc(local, LOCAL_TEXT, "markdown");
  const persistence = new IndexeddbPersistence(docsCollabIndexedDbKey(room), local);
  await persistence.whenSynced;
  await persistence.set(PENDING_SERVER_SAVE_KEY, 1);
  await persistence.destroy();
}

/** The same wiring as `DocsCollabWorkspace`. */
function renderDocsWorkspaceHooks(initialUrls: DocsCollabUrls) {
  return renderHook(
    ({ urls }) => {
      const request = useDocsExternalWriteRequest(urls);
      const collab = useDocsCollab({ userName: "Alex", autoJoin: true, urls: request.urls, wire });
      const prompt = useDocsExternalWritePrompt({
        request,
        ydoc: collab.session?.ydoc ?? null,
        resolveExternalWrite: collab.resolveExternalWrite,
      });
      return { collab, prompt, request };
    },
    { initialProps: { urls: initialUrls } },
  );
}

function documentText(result: { current: { collab: ReturnType<typeof useDocsCollab> } }) {
  const ydoc = result.current.collab.session?.ydoc;
  return ydoc ? readContentFromYDoc(ydoc) : "";
}

describe("Docs external write (#1349)", () => {
  beforeEach(() => {
    resetDocsCollabMeshLingerForTests();
    resetConnectivityHubForTests();
    resetDocsCollabBackoffForTests();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  });

  afterEach(() => {
    resetDocsCollabMeshLingerForTests();
    resetConnectivityHubForTests();
    resetDocsCollabBackoffForTests();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("rebuilds quietly from the outside text when nothing is unsaved", async () => {
    const puts: string[] = [];
    serveExternalWrite(puts);
    const urls = docsUrls("docs/external-rebuild.md");

    const { result } = renderDocsWorkspaceHooks(urls);

    await waitFor(() => expect(documentText(result)).toContain(OUTSIDE_TEXT), { timeout: 5000 });
    await waitFor(() => expect(puts).toContain(OUTSIDE_TEXT), { timeout: 5000 });
    expect(result.current.prompt.open).toBe(false);
  }, 15_000);

  it("asks once with unsaved work and writes nothing while the prompt is up", async () => {
    const room = "docs/external-prompt.md";
    await markUnsavedWork(room);
    const puts: string[] = [];
    serveExternalWrite(puts);

    const { result } = renderDocsWorkspaceHooks(docsUrls(room));

    await waitFor(() => expect(result.current.prompt.open).toBe(true), { timeout: 5000 });
    await act(() => new Promise((resolve) => setTimeout(resolve, 400)));
    expect(puts).toEqual([]);
    expect(documentText(result)).not.toContain(OUTSIDE_TEXT);

    act(() => result.current.prompt.useOutside());

    await waitFor(() => expect(result.current.prompt.open).toBe(false));
    expect(documentText(result)).toContain(OUTSIDE_TEXT);
    expect(puts.at(-1)).toBe(OUTSIDE_TEXT);
  }, 15_000);

  it("keeps the local document when the person chooses their own edits", async () => {
    const room = "docs/external-keep.md";
    await markUnsavedWork(room);
    const puts: string[] = [];
    serveExternalWrite(puts);

    const { result } = renderDocsWorkspaceHooks(docsUrls(room));
    await waitFor(() => expect(result.current.prompt.open).toBe(true), { timeout: 5000 });
    // The editor registers this getter in the workspace; saves wait for it.
    act(() => result.current.collab.registerMarkdownGetter(() => documentText(result)));

    act(() => result.current.prompt.keepLocal());

    await waitFor(() => expect(result.current.prompt.open).toBe(false));
    expect(puts).toHaveLength(1);
    expect(puts[0]).toContain(LOCAL_TEXT);
    expect(documentText(result)).toContain(LOCAL_TEXT);
    expect(documentText(result)).not.toContain(OUTSIDE_TEXT);
  }, 15_000);

  it("drops a prompt that belongs to another document", () => {
    const first = docsUrls("docs/first.md");
    const second = docsUrls("docs/second.md");
    const { result, rerender } = renderHook(({ urls }) => useDocsExternalWriteRequest(urls), {
      initialProps: { urls: second },
    });

    act(() =>
      result.current.urls?.onExternalWrite?.({
        markdown: OUTSIDE_TEXT,
        title: null,
        serverState: new Uint8Array([0, 0]),
      }),
    );
    expect(result.current.detail?.markdown).toBe(OUTSIDE_TEXT);

    rerender({ urls: first });
    expect(result.current.detail).toBeNull();
    rerender({ urls: second });
    expect(result.current.detail).toBeNull();
  });

  it("keeps the prompt and the hold when saving the outside version fails", async () => {
    const room = "docs/external-outside-fails.md";
    await markUnsavedWork(room);
    const puts: string[] = [];
    serveExternalWrite(puts, 503);

    const { result } = renderDocsWorkspaceHooks(docsUrls(room));
    await waitFor(() => expect(result.current.prompt.open).toBe(true), { timeout: 5000 });

    await act(async () => result.current.prompt.useOutside());
    await waitFor(() => expect(result.current.prompt.busy).toBe(false));
    const failedPuts = puts.length;
    expect(failedPuts).toBeGreaterThan(0);

    expect(result.current.prompt.open).toBe(true);
    // The local edits are already replaced, so "Keep my edits" would save the outside text.
    expect(result.current.prompt.keepLocalDisabled).toBe(true);
    // A retry from the sync toast must not save behind the open prompt.
    await act(async () => {
      await result.current.collab.saveNow().catch(() => undefined);
    });
    expect(puts).toHaveLength(failedPuts);
  }, 15_000);

  it("keeps the prompt and the hold when saving the local version fails", async () => {
    const room = "docs/external-keep-fails.md";
    await markUnsavedWork(room);
    const puts: string[] = [];
    serveExternalWrite(puts, 503);

    const { result } = renderDocsWorkspaceHooks(docsUrls(room));
    await waitFor(() => expect(result.current.prompt.open).toBe(true), { timeout: 5000 });
    act(() => result.current.collab.registerMarkdownGetter(() => documentText(result)));

    await act(async () => result.current.prompt.keepLocal());
    await waitFor(() => expect(result.current.prompt.busy).toBe(false));
    const failedPuts = puts.length;
    expect(failedPuts).toBeGreaterThan(0);

    expect(result.current.prompt.open).toBe(true);
    expect(result.current.prompt.keepLocalDisabled).toBe(false);
    // A retry from the sync toast must not save behind the open prompt.
    await act(async () => {
      await result.current.collab.saveNow().catch(() => undefined);
    });
    expect(puts).toHaveLength(failedPuts);
  }, 15_000);

  describe("an outside edit while the document is open", () => {
    async function openAndEdit(room: string, puts: RefusedPut[]) {
      serveOutsideEditWhileOpen(puts);
      const hooks = renderDocsWorkspaceHooks(docsUrls(room));
      const { result } = hooks;
      await waitFor(() => expect(result.current.collab.session).not.toBeNull(), {
        timeout: 5000,
      });
      act(() => result.current.collab.registerMarkdownGetter(() => documentText(result)));
      act(() => typeLocally(result.current.collab.session!.ydoc, LOCAL_TEXT));
      await act(async () => {
        await result.current.collab.saveNow().catch(() => undefined);
      });
      return hooks;
    }

    it("asks instead of overwriting, and writes nothing while asking", async () => {
      const puts: RefusedPut[] = [];
      const { result } = await openAndEdit("docs/open-refused.md", puts);

      await waitFor(() => expect(result.current.prompt.open).toBe(true));
      expect(puts).toHaveLength(1);
      expect(puts[0]?.seen).toBeUndefined();
      expect(result.current.collab.docStatus).not.toMatch(/save failed/i);

      await act(async () => {
        await result.current.collab.saveNow().catch(() => undefined);
      });
      expect(puts).toHaveLength(1);
    }, 15_000);

    it("Keep my edits saves the local text and names the outside text it saw", async () => {
      const puts: RefusedPut[] = [];
      const { result } = await openAndEdit("docs/open-keep.md", puts);
      await waitFor(() => expect(result.current.prompt.open).toBe(true));

      act(() => result.current.prompt.keepLocal());

      await waitFor(() => expect(result.current.prompt.open).toBe(false));
      expect(puts.at(-1)?.seen).toBe(OUTSIDE_TAG);
      expect(puts.at(-1)?.markdown).toContain(LOCAL_TEXT);
      expect(documentText(result)).toContain(LOCAL_TEXT);
    }, 15_000);

    it("Use the outside version replaces the document and saves it", async () => {
      const puts: RefusedPut[] = [];
      const { result } = await openAndEdit("docs/open-outside.md", puts);
      await waitFor(() => expect(result.current.prompt.open).toBe(true));

      act(() => result.current.prompt.useOutside());

      await waitFor(() => expect(result.current.prompt.open).toBe(false));
      expect(puts.at(-1)).toEqual({ markdown: OUTSIDE_TEXT, seen: OUTSIDE_TAG });
      expect(documentText(result)).toContain(OUTSIDE_TEXT);
      expect(documentText(result)).not.toContain(LOCAL_TEXT);
    }, 15_000);

    it("ends a pending offline save in the prompt, not in a retry loop", async () => {
      const room = "docs/open-offline.md";
      await markUnsavedWork(room);
      const puts: RefusedPut[] = [];
      serveOutsideEditWhileOpen(puts);

      const { result } = renderDocsWorkspaceHooks(docsUrls(room));
      await waitFor(() => expect(result.current.collab.session).not.toBeNull(), {
        timeout: 5000,
      });
      act(() => result.current.collab.registerMarkdownGetter(() => documentText(result)));
      await act(async () => {
        await result.current.collab.saveNow().catch(() => undefined);
      });

      await waitFor(() => expect(result.current.prompt.open).toBe(true));
      const refused = puts.length;
      await act(() => new Promise((resolve) => setTimeout(resolve, 2500)));
      expect(puts).toHaveLength(refused);
      expect(result.current.collab.pendingSync).toBe(true);
      expect(result.current.collab.docStatus).not.toMatch(/save failed/i);
    }, 15_000);
  });

  it("keeps Keep my edits disabled when a second outside edit lands during the answer", async () => {
    let version = 1;
    let raced = false;
    const puts: RefusedPut[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.includes("format=yjs")) {
          return new Response(staleState(), { status: 200, headers: { ETag: '"sidecar"' } });
        }
        if (method === "PUT") {
          const headers = (init?.headers ?? {}) as Record<string, string>;
          const seen = headers["X-Wgw-External-Write"];
          puts.push({ markdown: markdownFromFramedSave(init?.body), seen });
          if (seen === `"t${version}"` && !(version === 1 && !raced)) {
            return new Response("{}", { status: 200, headers: { ETag: '"saved"' } });
          }
          if (seen === '"t1"') {
            raced = true;
            version = 2;
          }
          return new Response(JSON.stringify({ error: "external_write" }), { status: 409 });
        }
        return new Response(`Outside text ${version}.`, {
          status: 200,
          headers: { "Content-Type": "text/markdown", ETag: `"t${version}"` },
        });
      }),
    );
    const { result } = renderDocsWorkspaceHooks(docsUrls("docs/open-chain.md"));
    await waitFor(() => expect(result.current.collab.session).not.toBeNull(), { timeout: 5000 });
    act(() => result.current.collab.registerMarkdownGetter(() => documentText(result)));
    act(() => typeLocally(result.current.collab.session!.ydoc, LOCAL_TEXT));
    await act(async () => {
      await result.current.collab.saveNow().catch(() => undefined);
    });
    await waitFor(() => expect(result.current.request.detail?.markdown).toBe("Outside text 1."));

    act(() => result.current.prompt.useOutside());

    await waitFor(() => expect(result.current.request.detail?.markdown).toBe("Outside text 2."));
    await waitFor(() => expect(result.current.prompt.busy).toBe(false));
    // The local edits are already gone: Keep my edits would save text 1 as "mine".
    expect(result.current.prompt.keepLocalDisabled).toBe(true);

    act(() => result.current.prompt.useOutside());
    await waitFor(() => expect(result.current.prompt.open).toBe(false));
    expect(puts.at(-1)).toEqual({ markdown: "Outside text 2.", seen: '"t2"' });
  }, 15_000);

  it("never sends one document's outside-text tag with another document's save", async () => {
    const puts: Array<{ url: string; seen: string | undefined }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        const isFirst = url.includes(encodeURIComponent("docs/tag-first.md"));
        if (url.includes("format=yjs")) {
          return new Response(staleState(), { status: 200, headers: { ETag: '"sidecar"' } });
        }
        if (method === "PUT") {
          const headers = (init?.headers ?? {}) as Record<string, string>;
          puts.push({ url, seen: headers["X-Wgw-External-Write"] });
          if (isFirst) {
            return new Response(JSON.stringify({ error: "external_write" }), { status: 409 });
          }
          return new Response("{}", { status: 200, headers: { ETag: '"saved"' } });
        }
        return new Response(OUTSIDE_TEXT, {
          status: 200,
          headers: { "Content-Type": "text/markdown", ETag: OUTSIDE_TAG },
        });
      }),
    );
    const first = docsUrls("docs/tag-first.md");
    const second = docsUrls("docs/tag-second.md");
    const { result, rerender } = renderDocsWorkspaceHooks(first);
    await waitFor(() => expect(result.current.collab.session).not.toBeNull(), { timeout: 5000 });
    act(() => result.current.collab.registerMarkdownGetter(() => documentText(result)));
    act(() => typeLocally(result.current.collab.session!.ydoc, LOCAL_TEXT));
    await act(async () => {
      await result.current.collab.saveNow().catch(() => undefined);
    });
    await waitFor(() => expect(result.current.prompt.open).toBe(true));

    rerender({ urls: second });
    await waitFor(() => expect(result.current.collab.session?.ydoc).not.toBe(undefined));
    await waitFor(() => expect(result.current.prompt.open).toBe(false));
    await waitFor(() => expect(result.current.collab.joined).toBe(true), { timeout: 5000 });
    act(() => result.current.collab.registerMarkdownGetter(() => documentText(result)));
    act(() => typeLocally(result.current.collab.session!.ydoc, "Typed in the second document."));
    await act(async () => {
      await result.current.collab.saveNow().catch(() => undefined);
    });

    const secondPuts = puts.filter((put) =>
      put.url.includes(encodeURIComponent("docs/tag-second.md")),
    );
    expect(secondPuts.length).toBeGreaterThan(0);
    expect(secondPuts.every((put) => put.seen === undefined)).toBe(true);
  }, 15_000);

  it("rebuilds in the format the caller gives, not the one the room name suggests", async () => {
    const puts: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("format=yjs")) {
          return new Response(staleState(), {
            status: 200,
            headers: { ETag: '"state"', "X-Wgw-External-Write": "1" },
          });
        }
        if ((init?.method ?? "GET") === "PUT") {
          puts.push(markdownFromFramedSave(init?.body));
          return new Response("{}", { status: 200, headers: { ETag: '"saved"' } });
        }
        return new Response(JSON.stringify({ body: "# Outside heading", contentEtag: '"c"' }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
    // A note UID can end in an extension that names a plain-text file.
    const room = "n1@host.json";
    const documentUrl = `/api/v1/notes/items/${encodeURIComponent(room)}`;
    const { result } = renderDocsWorkspaceHooks({
      ...DEFAULT_DOCS_COLLAB_URLS,
      room,
      documentUrl,
      yjsUrl: `${documentUrl}?format=yjs`,
      documentFormat: "markdown",
    });

    await waitFor(
      () =>
        expect(result.current.collab.session?.ydoc.getXmlFragment("default").toString()).toContain(
          "<heading",
        ),
      { timeout: 5000 },
    );
  }, 15_000);

  it("ends a pending offline Notes save in the prompt and keeps it with the content tag", async () => {
    const room = "note-offline-refused";
    await markUnsavedWork(room);
    const puts: RefusedPut[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.includes("format=yjs")) {
          return new Response(staleState(), { status: 200, headers: { ETag: '"state"' } });
        }
        if (method === "PUT") {
          const headers = (init?.headers ?? {}) as Record<string, string>;
          const seen = headers["X-Wgw-External-Write"];
          puts.push({ markdown: markdownFromFramedSave(init?.body), seen });
          if (seen !== '"content-outside"') {
            return new Response(
              JSON.stringify({ error: "external_write", code: "external_write" }),
              {
                status: 409,
              },
            );
          }
          return new Response("{}", { status: 200, headers: { ETag: '"saved"' } });
        }
        return new Response(
          JSON.stringify({
            body: OUTSIDE_TEXT,
            title: "Outside",
            contentEtag: '"content-outside"',
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json", ETag: '"journal-etag"' },
          },
        );
      }),
    );
    const documentUrl = `/api/v1/notes/items/${room}`;
    const { result } = renderDocsWorkspaceHooks({
      ...DEFAULT_DOCS_COLLAB_URLS,
      room,
      documentUrl,
      yjsUrl: `${documentUrl}?format=yjs`,
    });
    await waitFor(() => expect(result.current.collab.session).not.toBeNull(), { timeout: 5000 });
    act(() => result.current.collab.registerMarkdownGetter(() => documentText(result)));
    await act(async () => {
      await result.current.collab.saveNow().catch(() => undefined);
    });

    await waitFor(() => expect(result.current.prompt.open).toBe(true));
    expect(result.current.request.detail?.title).toBe("Outside");
    expect(result.current.collab.docStatus).not.toMatch(/save failed|external_write/i);

    act(() => result.current.prompt.keepLocal());

    await waitFor(() => expect(result.current.prompt.open).toBe(false));
    // The content tag, not the journal ETag: a tag or move while asking does not ask again.
    expect(puts.at(-1)?.seen).toBe('"content-outside"');
  }, 15_000);

  it("shows a prompt that Escape cannot dismiss", () => {
    const labels = docsLabels.externalWriteDialog;
    render(
      <DocsConflictDialog
        open
        documentTitle="notes.md"
        labels={labels}
        onKeepLocal={vi.fn()}
        onUseServer={vi.fn()}
      />,
    );

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText(labels.conflictTitle)).toBeTruthy();
    expect(screen.getByRole("button", { name: labels.conflictUseServer })).toBeTruthy();
    expect(screen.getByRole("button", { name: labels.conflictKeepMine })).toBeTruthy();
  });
});
