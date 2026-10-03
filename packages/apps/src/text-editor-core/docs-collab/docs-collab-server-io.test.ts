import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import {
  fetchYjsSnapshot,
  loadMarkdown,
  loadYjsSnapshot,
  saveDocument,
} from "./docs-collab-server-io";

/** ETags are opaque to the client, so the tests use a readable stand-in. */
const SIDECAR_ETAG = '"sidecar-rev-1"';

function snapshotBytes(text: string): Uint8Array {
  const source = new Y.Doc();
  source.getText("default").insert(0, text);
  return Y.encodeStateAsUpdate(source);
}

describe("docs-collab-server-io", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loadMarkdown returns text on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("# Hello", { status: 200 })),
    );
    await expect(loadMarkdown("/doc")).resolves.toBe("# Hello");
  });

  it("loadMarkdown throws on non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 404 })),
    );
    await expect(loadMarkdown("/doc")).rejects.toThrow("Could not load document (404)");
  });

  it("loadYjsSnapshot reports no snapshot for 204", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 })),
    );
    const ydoc = new Y.Doc();
    await expect(loadYjsSnapshot("/yjs", ydoc)).resolves.toEqual({ applied: false, etag: null });
  });

  it("loadYjsSnapshot applies update and returns the ETag on success", async () => {
    const update = snapshotBytes("hi");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(update as unknown as BodyInit, {
            status: 200,
            headers: { ETag: SIDECAR_ETAG },
          }),
      ),
    );
    const target = new Y.Doc();
    await expect(loadYjsSnapshot("/yjs", target)).resolves.toEqual({
      applied: true,
      etag: SIDECAR_ETAG,
    });
    expect(target.getText("default").toString()).toBe("hi");
  });

  // C7: only a 204 means "no snapshot". Treating a 5xx or a token race as
  // "no snapshot" is what lets a second client seed a duplicate copy.
  it.each([401, 403, 500, 502, 503])(
    "loadYjsSnapshot throws instead of reporting no snapshot for %i",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("", { status })),
      );
      const ydoc = new Y.Doc();
      await expect(loadYjsSnapshot("/yjs", ydoc)).rejects.toThrow(
        `Could not load snapshot (${status})`,
      );
      expect(ydoc.getText("default").toString()).toBe("");
    },
  );

  it("fetchYjsSnapshot returns the raw bytes without applying them", async () => {
    const update = snapshotBytes("hi");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(update as unknown as BodyInit, {
            status: 200,
            headers: { ETag: SIDECAR_ETAG },
          }),
      ),
    );
    const snapshot = await fetchYjsSnapshot("/yjs");
    expect(snapshot.etag).toBe(SIDECAR_ETAG);
    expect(Array.from(snapshot.update ?? [])).toEqual(Array.from(update));
  });

  it("fetchYjsSnapshot reports a missing sidecar for 204", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 })),
    );
    await expect(fetchYjsSnapshot("/yjs")).resolves.toEqual({ update: null, etag: null });
  });

  it("saveDocument throws parsed error message from body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "network down" }), { status: 503 })),
    );
    const ydoc = new Y.Doc();
    await expect(saveDocument("/doc", "# x", ydoc, undefined)).rejects.toThrow("network down");
  });

  it("saveDocument succeeds on ok response", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const ydoc = new Y.Doc();
    await saveDocument("/doc", "# x", ydoc, "docs/test.md", "token", "PUT");
    expect(fetchMock).toHaveBeenCalledWith(
      "/doc",
      expect.objectContaining({
        method: "PUT",
        headers: expect.objectContaining({ Authorization: "Bearer token" }),
      }),
    );
  });

  it("saveDocument sends If-Match when the client loaded a sidecar", async () => {
    const fetchMock = vi.fn(
      async () => new Response("{}", { status: 200, headers: { ETag: SIDECAR_ETAG } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const ydoc = new Y.Doc();

    const nextEtag = await saveDocument("/doc", "# x", ydoc, "docs/test.md", undefined, "PUT", {
      name: "If-Match",
      value: SIDECAR_ETAG,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/doc",
      expect.objectContaining({
        headers: expect.objectContaining({ "If-Match": SIDECAR_ETAG }),
      }),
    );
    expect(nextEtag).toBe(SIDECAR_ETAG);
  });

  it("saveDocument sends If-None-Match: * when the client has no sidecar", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const ydoc = new Y.Doc();

    await saveDocument("/doc", "# x", ydoc, "docs/test.md", undefined, "PUT", {
      name: "If-None-Match",
      value: "*",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/doc",
      expect.objectContaining({
        headers: expect.objectContaining({ "If-None-Match": "*" }),
      }),
    );
  });

  it("saveDocument sends no precondition when the sidecar state is unknown", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const ydoc = new Y.Doc();

    await saveDocument("/doc", "# x", ydoc, "docs/test.md", undefined, "PUT", null);

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers).not.toHaveProperty("If-Match");
    expect(headers).not.toHaveProperty("If-None-Match");
  });

  // The remerge path keys off the status, and `precondition_failed` carries no
  // "(412)" in its message once the body is parsed.
  it("saveDocument surfaces a 412 as a status-carrying error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify({ error: "precondition_failed" }), { status: 412 }),
      ),
    );
    const ydoc = new Y.Doc();

    await expect(
      saveDocument("/doc", "# x", ydoc, "docs/test.md", undefined, "PUT", {
        name: "If-Match",
        value: SIDECAR_ETAG,
      }),
    ).rejects.toMatchObject({ status: 412 });
  });
});
