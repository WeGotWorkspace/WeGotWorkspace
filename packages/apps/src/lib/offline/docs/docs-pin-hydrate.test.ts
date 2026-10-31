/** @vitest-environment jsdom */
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import { hydrateDocsCollabForOffline } from "@/lib/offline/docs/docs-pin-hydrate";
import { resolveDocsCollabDatabase } from "@/text-editor-core/docs-collab/docs-collab-persistence";
import { isYDocEmpty } from "@/text-editor-core/docs-collab/docs-collab-utils";

vi.mock("@/lib/api/wgw/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/wgw/http")>()),
  wgwApiBaseUrl: () => "/api/v1",
  wgwEnsureFreshAccessToken: async () => "token",
}));

vi.mock("@/lib/offline/core/browser-online", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/offline/core/browser-online")>()),
  getConnectivitySnapshot: () => true,
}));

function sidecarBytes(): Uint8Array {
  const doc = new Y.Doc();
  doc.getXmlFragment("default").insert(0, [new Y.XmlElement("paragraph")]);
  const update = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return update;
}

type Route = { status: number; body?: BodyInit | null; headers?: Record<string, string> };

function stubFetch(routes: { yjs: Route; markdown?: Route }) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const route = url.includes("format=yjs") ? routes.yjs : routes.markdown;
    if (!route) throw new Error(`unexpected request ${url}`);
    return new Response(route.body ?? null, { status: route.status, headers: route.headers });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function localDocIsEmpty(apiPath: string): Promise<boolean> {
  const database = await resolveDocsCollabDatabase(apiPath);
  const ydoc = new Y.Doc();
  const persistence = new IndexeddbPersistence(database.name, ydoc);
  await persistence.whenSynced;
  const empty = isYDocEmpty(ydoc);
  await persistence.destroy();
  ydoc.destroy();
  return empty;
}

let room = 0;
function nextPath(): string {
  room += 1;
  return `users/alice/hydrate-${room}.md`;
}

describe("hydrateDocsCollabForOffline", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("makes one request when the server has a sidecar", async () => {
    const apiPath = nextPath();
    const fetchMock = stubFetch({
      yjs: { status: 200, body: sidecarBytes() as BodyInit, headers: { ETag: '"s1"' } },
    });
    const beforeRequest = vi.fn(async () => undefined);

    await hydrateDocsCollabForOffline({ apiPath, beforeRequest });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(beforeRequest).toHaveBeenCalledTimes(1);
    expect(await localDocIsEmpty(apiPath)).toBe(false);
  });

  it("makes one request when there is no sidecar: the server falls back to the markdown", async () => {
    const apiPath = nextPath();
    const fetchMock = stubFetch({
      yjs: {
        status: 200,
        body: "# Hello",
        headers: { "content-type": "text/markdown", "X-Wgw-Collab-Fallback": "markdown" },
      },
    });
    const beforeRequest = vi.fn(async () => undefined);

    await hydrateDocsCollabForOffline({ apiPath, beforeRequest });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toContain("format=yjs&fallback=markdown");
    expect(beforeRequest).toHaveBeenCalledTimes(1);
    expect(await localDocIsEmpty(apiPath)).toBe(false);
  });

  it("fetches the markdown separately from a server without the fallback (204)", async () => {
    const apiPath = nextPath();
    const fetchMock = stubFetch({
      yjs: { status: 204 },
      markdown: { status: 200, body: "# Hello", headers: { "content-type": "text/markdown" } },
    });
    const beforeRequest = vi.fn(async () => undefined);

    await hydrateDocsCollabForOffline({ apiPath, beforeRequest });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(beforeRequest).toHaveBeenCalledTimes(2);
    expect(await localDocIsEmpty(apiPath)).toBe(false);
  });

  it("throws a 429 at once, with its Retry-After, instead of retrying", async () => {
    const apiPath = nextPath();
    const fetchMock = stubFetch({ yjs: { status: 429, headers: { "Retry-After": "7" } } });

    await expect(hydrateDocsCollabForOffline({ apiPath })).rejects.toMatchObject({
      status: 429,
      retryAfterMs: 7_000,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await localDocIsEmpty(apiPath)).toBe(true);
  });

  it("makes no request when the local copy is kept and not empty", async () => {
    const apiPath = nextPath();
    stubFetch({ yjs: { status: 200, body: sidecarBytes() as BodyInit } });
    await hydrateDocsCollabForOffline({ apiPath });

    const fetchMock = stubFetch({ yjs: { status: 500 } });
    await hydrateDocsCollabForOffline({ apiPath, keepLocalCopy: true });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still fetches a kept copy that is empty", async () => {
    const apiPath = nextPath();
    const fetchMock = stubFetch({
      yjs: { status: 200, body: sidecarBytes() as BodyInit },
    });

    await hydrateDocsCollabForOffline({ apiPath, keepLocalCopy: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await localDocIsEmpty(apiPath)).toBe(false);
  });
});
