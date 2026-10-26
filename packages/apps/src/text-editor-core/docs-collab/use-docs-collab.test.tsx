import "fake-indexeddb/auto";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { docsLabels } from "@/docs-core/src/docs-labels";
import { setDocsSyncConflictListener } from "@/lib/offline/docs/docs-sync-conflicts";
import { decodeFramedPayload } from "@/lib/wire/framed-payload";
import {
  getConnectivitySnapshot,
  resetConnectivityHubForTests,
} from "@/lib/offline/browser-online";
import { DEFAULT_RTC_SETTINGS } from "@/lib/rtc/types";
import { resetDocsCollabMeshLingerForTests } from "./docs-collab-mesh-linger";
import { roomServerAllowed } from "./docs-collab-room-backoff";
import type { DocsCollabWireOperations } from "./docs-collab-wire";
import { IndexeddbPersistence } from "y-indexeddb";
import { docsCollabIndexedDbKey } from "./docs-collab-persistence";
import { PENDING_SERVER_SAVE_KEY } from "./pending-server-save-key";
import { LEADER_CLAIM_GRACE_MS } from "./docs-collab-tab-sync";
import { readContentFromYDoc } from "./docs-collab-editor-surface";
import {
  useDocsCollab,
  DEFAULT_DOCS_COLLAB_URLS,
  resetDocsCollabBackoffForTests,
} from "./use-docs-collab";

const rtcMocks = vi.hoisted(() => ({
  mockJoin: vi.fn(),
  mockLeave: vi.fn(),
  mockBroadcast: vi.fn(),
  mockOnMessage: vi.fn(),
  mockGetPeerIds: vi.fn(() => [] as string[]),
  mockGetRoomPeers: vi.fn(() => [] as { id: string; name: string }[]),
  mockLinkCount: vi.fn(() => 0),
  mockGetRoomPeerStatuses: vi.fn(() => [] as { id: string; name: string; link: string }[]),
  mockGetMyId: vi.fn(() => "peer-a"),
  mockGetMyName: vi.fn(() => "Alex"),
  mockClearMessageListeners: vi.fn(),
}));

vi.mock("./docs-rtc-session", () => ({
  DocsRtcSession: class MockDocsRtcSession {
    join = rtcMocks.mockJoin;
    leave = rtcMocks.mockLeave;
    broadcast = rtcMocks.mockBroadcast;
    onMessage = rtcMocks.mockOnMessage;
    getPeerIds = rtcMocks.mockGetPeerIds;
    getRoomPeers = rtcMocks.mockGetRoomPeers;
    linkCount = rtcMocks.mockLinkCount;
    getRoomPeerStatuses = rtcMocks.mockGetRoomPeerStatuses;
    getMyId = rtcMocks.mockGetMyId;
    getMyName = rtcMocks.mockGetMyName;
    clearMessageListeners = rtcMocks.mockClearMessageListeners;
    sendTo = vi.fn();
  },
}));

const { mockJoin } = rtcMocks;

class MockBroadcastChannel {
  static peers: MockBroadcastChannel[] = [];

  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(_name: string) {
    MockBroadcastChannel.peers.push(this);
  }

  postMessage(data: unknown): void {
    for (const peer of MockBroadcastChannel.peers) {
      if (peer !== this) peer.onmessage?.({ data } as MessageEvent);
    }
  }

  close(): void {
    const index = MockBroadcastChannel.peers.indexOf(this);
    if (index >= 0) MockBroadcastChannel.peers.splice(index, 1);
  }
}

const wire: DocsCollabWireOperations = {
  fetchAuthToken: vi.fn(async () => "test-token"),
  fetchRtcSettings: vi.fn(async () => DEFAULT_RTC_SETTINGS),
};

const testUrls = {
  ...DEFAULT_DOCS_COLLAB_URLS,
  room: "docs/offline-test.md",
  documentUrl: "/api/v1/files/collaboration?path=docs%2Foffline-test.md",
  yjsUrl: "/api/v1/files/collaboration?path=docs%2Foffline-test.md&format=yjs",
};

function reconnectMarkerUpdate(marker: string): ArrayBuffer {
  const doc = new Y.Doc();
  doc.getText("reconnect-marker").insert(0, marker);
  const update = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  const body = new ArrayBuffer(update.byteLength);
  new Uint8Array(body).set(update);
  return body;
}

function mockFetchResponses(options: {
  markdown?: string;
  yjsStatus?: number;
  saveFails?: boolean;
  loadFails?: boolean;
}) {
  const { markdown = "# Hello", yjsStatus = 204, saveFails = false, loadFails = false } = options;
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (loadFails) {
      throw new TypeError("Failed to fetch");
    }
    if (url.includes("format=yjs")) {
      return new Response(yjsStatus === 204 ? null : new Uint8Array([1, 2, 3]), {
        status: yjsStatus,
      });
    }
    if (init?.method === "PUT" || init?.method === "POST") {
      if (saveFails) {
        return new Response(JSON.stringify({ error: "network down" }), { status: 503 });
      }
      return new Response("{}", { status: 200 });
    }
    return new Response(markdown, { status: 200 });
  });
}

const SESSION_WAIT_MS = 5000;

async function waitForCollabSession(
  result: { current: { session: unknown } },
  timeoutMs: number = SESSION_WAIT_MS,
): Promise<void> {
  await waitFor(() => expect(result.current.session).not.toBeNull(), {
    timeout: timeoutMs,
  });
}

describe("useDocsCollab offline lifecycle", () => {
  beforeEach(async () => {
    resetDocsCollabMeshLingerForTests();
    vi.clearAllMocks();
    MockBroadcastChannel.peers = [];
    Reflect.deleteProperty(globalThis, "BroadcastChannel");
    vi.stubGlobal("BroadcastChannel", MockBroadcastChannel);
    resetConnectivityHubForTests();
    resetDocsCollabBackoffForTests();
    mockJoin.mockResolvedValue({ peers: [] });
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    vi.stubGlobal("fetch", mockFetchResponses({}));
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(testUrls.room);
      request.onblocked = () => resolve();
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    });
  });

  afterEach(() => {
    resetDocsCollabMeshLingerForTests();
    resetConnectivityHubForTests();
    resetDocsCollabBackoffForTests();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("joins offline without mesh and exposes an editing session", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);

    const { result } = renderHook(() =>
      useDocsCollab({
        userName: "Alex",
        autoJoin: true,
        urls: testUrls,
        wire,
      }),
    );

    await waitForCollabSession(result);
    expect(result.current.joined).toBe(true);
    expect(result.current.status).toBe("Editing offline");
    expect(mockJoin).not.toHaveBeenCalled();
  });

  it("seeds an empty offline doc from seedContent (e.g. cached note body)", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);

    const { result } = renderHook(() =>
      useDocsCollab({
        userName: "Alex",
        autoJoin: true,
        urls: testUrls,
        wire,
        seedContent: "# Seeded note body",
      }),
    );

    await waitForCollabSession(result);
    await waitFor(() => {
      const ydoc = result.current.session?.ydoc;
      expect(ydoc && ydoc.getXmlFragment("default").length).toBeGreaterThan(0);
    });
  });

  it("falls back to seedContent only when the server has no markdown yet", async () => {
    vi.stubGlobal("fetch", mockFetchResponses({ markdown: "" }));

    const { result } = renderHook(() =>
      useDocsCollab({
        userName: "Alex",
        autoJoin: true,
        urls: testUrls,
        wire,
        seedContent: "# From cached body",
      }),
    );

    await waitForCollabSession(result);
    await waitFor(() => {
      const ydoc = result.current.session?.ydoc;
      expect(ydoc && ydoc.getXmlFragment("default").length).toBeGreaterThan(0);
    });
  });

  it("marks pendingSync when editing offline", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);

    const { result } = renderHook(() =>
      useDocsCollab({
        userName: "Alex",
        autoJoin: true,
        urls: testUrls,
        wire,
      }),
    );

    await waitForCollabSession(result);

    act(() => {
      result.current.onMarkdownChange(() => "# offline edit");
    });

    await waitFor(() => expect(result.current.pendingSync).toBe(true));
  });

  it("flushes IDB pending save once the markdown getter is registered", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    vi.stubGlobal("fetch", mockFetchResponses({}));

    const { result } = renderHook(() =>
      useDocsCollab({
        userName: "Alex",
        autoJoin: true,
        urls: testUrls,
        wire,
      }),
    );

    await waitForCollabSession(result);

    act(() => {
      result.current.onMarkdownChange(() => "# offline edit");
    });
    await waitFor(() => expect(result.current.pendingSync).toBe(true));

    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    vi.stubGlobal("fetch", mockFetchResponses({}));
    resetConnectivityHubForTests();
    window.dispatchEvent(new Event("online"));

    act(() => {
      result.current.registerMarkdownGetter(() => "# offline edit");
    });

    await waitFor(() => expect(result.current.pendingSync).toBe(false), { timeout: 5000 });
  });

  it("joins online with mesh after IDB sync and server fetch", async () => {
    const { result } = renderHook(() =>
      useDocsCollab({
        userName: "Alex",
        autoJoin: true,
        urls: testUrls,
        wire,
      }),
    );

    await waitForCollabSession(result);
    // The tab claims the mesh after the leader-claim grace.
    await waitFor(() => expect(mockJoin).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.status).toContain("Alex ·"));
  });

  it("reuses the lingering mesh session when remounting the same room within the grace", async () => {
    const first = renderHook(() =>
      useDocsCollab({
        userName: "Alex",
        autoJoin: true,
        urls: testUrls,
        wire,
      }),
    );

    await waitForCollabSession(first.result);
    await waitFor(() => expect(mockJoin).toHaveBeenCalledTimes(1));

    await act(async () => {
      first.unmount();
    });
    expect(rtcMocks.mockLeave).not.toHaveBeenCalled();
    expect(rtcMocks.mockClearMessageListeners).toHaveBeenCalledTimes(1);

    const second = renderHook(() =>
      useDocsCollab({
        userName: "Alex",
        autoJoin: true,
        urls: testUrls,
        wire,
      }),
    );

    await waitForCollabSession(second.result);
    await waitFor(() => expect(second.result.current.status).toContain("Alex ·"));
    expect(mockJoin).toHaveBeenCalledTimes(1);
    expect(rtcMocks.mockLeave).not.toHaveBeenCalled();
  });

  it("exposes the collab session while server markdown is still loading", async () => {
    let markdownReady: Response | null = null;
    const pendingMarkdown: Array<(value: Response) => void> = [];
    let resolveMarkdown: (() => void) | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("format=yjs")) {
        return new Response(null, { status: 204 });
      }
      if (init?.method === "PUT" || init?.method === "POST") {
        return new Response("{}", { status: 200 });
      }
      if (markdownReady) return markdownReady;
      return new Promise<Response>((resolve) => {
        pendingMarkdown.push(resolve);
        resolveMarkdown = () => {
          markdownReady = new Response("# Hello", { status: 200 });
          for (const settle of pendingMarkdown) settle(markdownReady);
          pendingMarkdown.length = 0;
        };
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() =>
      useDocsCollab({
        userName: "Alex",
        autoJoin: true,
        urls: testUrls,
        wire,
      }),
    );

    await waitForCollabSession(result);
    expect(fetchMock).toHaveBeenCalled();
    expect(resolveMarkdown).toBeDefined();

    await act(async () => {
      resolveMarkdown?.();
    });
    await waitFor(() => {
      expect(result.current.session?.ydoc.getXmlFragment("default").length).toBeGreaterThan(0);
    });
  }, 15000);

  it("exposes session before mesh join completes", async () => {
    let resolveJoin: ((value: { peers: [] }) => void) | undefined;
    mockJoin.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveJoin = resolve;
        }),
    );

    const { result } = renderHook(() =>
      useDocsCollab({
        userName: "Alex",
        autoJoin: true,
        urls: testUrls,
        wire,
      }),
    );

    await waitForCollabSession(result);
    expect(result.current.joined).toBe(true);
    await waitFor(() => expect(mockJoin).toHaveBeenCalledTimes(1));
    expect(result.current.status).toBe(docsLabels.statusConnecting);

    await act(async () => {
      resolveJoin?.({ peers: [] });
    });

    await waitFor(() => expect(result.current.status).toContain("Alex ·"));
  });

  it("marks pendingSync when server save fails while online", async () => {
    vi.stubGlobal("fetch", mockFetchResponses({ saveFails: true }));

    const { result } = renderHook(() =>
      useDocsCollab({
        userName: "Alex",
        autoJoin: true,
        urls: testUrls,
        wire,
      }),
    );

    await waitForCollabSession(result);

    act(() => {
      result.current.onMarkdownChange(() => "# edited");
    });

    await waitFor(
      () => {
        expect(result.current.pendingSync).toBe(true);
        expect(result.current.failedSync).toBe(true);
      },
      { timeout: 5000 },
    );
  });

  it("restores pendingSync from IDB meta on reopen", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    vi.stubGlobal("fetch", mockFetchResponses({ saveFails: true, loadFails: true }));

    const first = renderHook(() =>
      useDocsCollab({
        userName: "Alex",
        autoJoin: true,
        urls: testUrls,
        wire,
      }),
    );

    await waitForCollabSession(first.result);

    act(() => {
      first.result.current.onMarkdownChange(() => "# offline edit");
    });

    await waitFor(() => expect(first.result.current.pendingSync).toBe(true), { timeout: 5000 });
    await act(async () => {
      await first.unmount();
    });

    const second = renderHook(() =>
      useDocsCollab({
        userName: "Alex",
        autoJoin: true,
        urls: testUrls,
        wire,
      }),
    );

    await waitFor(() => expect(second.result.current.pendingSync).toBe(true));
    expect(getConnectivitySnapshot()).toBe(false);
  });

  it("rejoins mesh after reconnect from offline session", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);

    const { result } = renderHook(() =>
      useDocsCollab({
        userName: "Alex",
        autoJoin: true,
        urls: testUrls,
        wire,
      }),
    );

    await waitForCollabSession(result);
    expect(mockJoin).not.toHaveBeenCalled();

    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    vi.stubGlobal("fetch", mockFetchResponses({}));
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("focus"));

    await waitFor(() => expect(mockJoin).toHaveBeenCalledTimes(1), { timeout: 7000 });
    await waitFor(() => expect(result.current.status).toContain("Alex ·"), { timeout: 7000 });
  }, 15_000);

  it("flushes pending save after reconnect", async () => {
    let online = false;
    vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
    vi.stubGlobal("fetch", mockFetchResponses({ loadFails: true, saveFails: true }));

    const { result } = renderHook(() =>
      useDocsCollab({
        userName: "Alex",
        autoJoin: true,
        urls: testUrls,
        wire,
      }),
    );

    await waitForCollabSession(result);

    act(() => {
      result.current.onMarkdownChange(() => "# reconnect edit");
    });
    await waitFor(() => expect(result.current.pendingSync).toBe(true), { timeout: 5000 });

    online = true;
    vi.stubGlobal("fetch", mockFetchResponses({ saveFails: false }));
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("focus"));

    await waitFor(() => expect(result.current.pendingSync).toBe(false), { timeout: 7000 });
  }, 15_000);

  it("does not save a room that is not persistent yet", async () => {
    const fetchMock = mockFetchResponses({ markdown: "# Hello" });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() =>
      useDocsCollab({
        userName: "Alex",
        autoJoin: true,
        urls: { ...testUrls, roomNotPersistent: true },
        wire,
      }),
    );

    await waitForCollabSession(result);
    act(() => {
      result.current.onMarkdownChange(() => "# edited before the note exists");
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2500));
    });

    const saves = fetchMock.mock.calls.filter(([, init]) => {
      const method = init?.method ?? "GET";
      return method === "PUT" || method === "POST" || method === "PATCH";
    });
    expect(saves).toEqual([]);
  }, 15_000);

  it("fetches and applies the yjs snapshot on reconnect", async () => {
    let online = false;
    vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
    const marker = "server-snapshot";
    const update = reconnectMarkerUpdate(marker);
    const yjsRequests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("format=yjs")) {
          yjsRequests.push(url);
          return new Response(update, { status: 200 });
        }
        if (init?.method === "PUT" || init?.method === "POST") {
          return new Response("{}", { status: 200 });
        }
        return new Response("# Hello", { status: 200 });
      }),
    );

    const { result } = renderHook(() =>
      useDocsCollab({
        userName: "Alex",
        autoJoin: true,
        urls: testUrls,
        wire,
      }),
    );

    await waitForCollabSession(result);
    expect(result.current.session?.ydoc.getText("reconnect-marker").toString()).toBe("");

    online = true;
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("focus"));

    await waitFor(
      () => {
        expect(result.current.session?.ydoc.getText("reconnect-marker").toString()).toBe(marker);
      },
      { timeout: 7000 },
    );
    expect(yjsRequests.length).toBeGreaterThan(0);
    expect(roomServerAllowed(testUrls.room)).toBe(true);
  }, 15_000);

  it("remerges a 412 and does not open the conflict dialog", async () => {
    const update = reconnectMarkerUpdate("server-snapshot");
    let puts = 0;
    const listener = vi.fn();
    setDocsSyncConflictListener(listener);
    const noteUrls = {
      ...testUrls,
      documentUrl: "/api/v1/notes/items/note-1",
      yjsUrl: "/api/v1/notes/items/note-1?format=yjs",
      room: "note-1",
    };
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase("note-1:v2");
      request.onblocked = () => resolve();
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.includes("format=yjs")) {
          return new Response(update, { status: 200, headers: { ETag: '"snap"' } });
        }
        if (method === "PUT" || method === "POST" || method === "PATCH") {
          puts += 1;
          if (puts === 1) {
            return new Response(JSON.stringify({ error: "precondition_failed" }), { status: 412 });
          }
          return new Response("{}", { status: 200, headers: { ETag: '"saved"' } });
        }
        return new Response("# Hello", {
          status: 200,
          headers: { "Content-Type": "text/markdown" },
        });
      }),
    );

    const { result } = renderHook(() =>
      useDocsCollab({
        userName: "Alex",
        autoJoin: true,
        urls: noteUrls,
        wire,
      }),
    );

    await waitForCollabSession(result);
    act(() => {
      result.current.onMarkdownChange(() => "# Hello");
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
    });
    act(() => {
      result.current.onMarkdownChange(() => "# Hello\n\nedited");
    });

    await waitFor(() => expect(puts).toBe(2), { timeout: 7000 });
    expect(listener).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.pendingSync).toBe(false), { timeout: 7000 });
    setDocsSyncConflictListener(undefined);
  }, 20_000);

  it("rejoins mesh after offline refresh reconnect", async () => {
    let online = false;
    vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);

    const { result } = renderHook(() =>
      useDocsCollab({
        userName: "Alex",
        autoJoin: true,
        urls: testUrls,
        wire,
      }),
    );

    await waitForCollabSession(result);
    expect(result.current.status).toBe("Editing offline");
    expect(mockJoin).not.toHaveBeenCalled();

    online = true;
    window.dispatchEvent(new Event("online"));

    await waitFor(() => expect(mockJoin).toHaveBeenCalledTimes(1), { timeout: 5000 });
    await waitFor(() => expect(result.current.status).toContain("Alex ·"));
  });

  it("rejoins mesh even when server backoff blocks collaboration GET", async () => {
    let online = true;
    vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
    vi.stubGlobal("fetch", mockFetchResponses({ saveFails: true }));

    const { result } = renderHook(() =>
      useDocsCollab({
        userName: "Alex",
        autoJoin: true,
        urls: testUrls,
        wire,
      }),
    );

    await waitForCollabSession(result);
    await waitFor(() => expect(mockJoin).toHaveBeenCalledTimes(1));

    act(() => {
      result.current.onMarkdownChange(() => "# edited before backoff");
    });
    await waitFor(() => expect(result.current.pendingSync).toBe(true), { timeout: 5000 });

    const joinsBeforeReconnect = mockJoin.mock.calls.length;
    online = false;
    window.dispatchEvent(new Event("offline"));

    online = true;
    vi.stubGlobal("fetch", mockFetchResponses({ saveFails: false }));
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("focus"));

    await waitFor(() => expect(mockJoin.mock.calls.length).toBeGreaterThan(joinsBeforeReconnect), {
      timeout: 7000,
    });
    await waitFor(() => expect(result.current.status).toContain("Alex ·"), { timeout: 7000 });
  }, 15000);

  it("restarts mesh after reconnect when a stale session exists", async () => {
    let online = true;
    vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);

    const { result } = renderHook(() =>
      useDocsCollab({
        userName: "Alex",
        autoJoin: true,
        urls: testUrls,
        wire,
      }),
    );

    await waitForCollabSession(result);
    await waitFor(() => expect(mockJoin).toHaveBeenCalledTimes(1));

    online = false;
    window.dispatchEvent(new Event("offline"));
    online = true;
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("focus"));

    await waitFor(() => expect(rtcMocks.mockLeave).toHaveBeenCalled(), { timeout: 7000 });
    expect(mockJoin.mock.calls.length).toBeGreaterThan(1);
  }, 15000);

  it("does not rejoin when wire object identity changes", async () => {
    const makeWire = (): DocsCollabWireOperations => ({
      fetchAuthToken: vi.fn(async () => "test-token"),
      fetchRtcSettings: vi.fn(async () => DEFAULT_RTC_SETTINGS),
    });

    const { result, rerender } = renderHook(
      ({ nextWire }) =>
        useDocsCollab({
          userName: "Alex",
          autoJoin: true,
          urls: testUrls,
          wire: nextWire,
        }),
      { initialProps: { nextWire: makeWire() } },
    );

    await waitForCollabSession(result);
    await waitFor(() => expect(mockJoin).toHaveBeenCalledTimes(1));

    rerender({ nextWire: makeWire() });
    await waitForCollabSession(result);
    // A rejoin would claim the mesh again only after the grace.
    await new Promise((resolve) => setTimeout(resolve, LEADER_CLAIM_GRACE_MS + 100));
    expect(mockJoin).toHaveBeenCalledTimes(1);
  });

  it("stays network-idle after settle until user edits", async () => {
    const fetchMock = mockFetchResponses({ markdown: "# Hello" });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() =>
      useDocsCollab({
        userName: "Alex",
        autoJoin: true,
        urls: testUrls,
        wire,
      }),
    );

    await waitForCollabSession(result);
    await waitFor(() => expect(mockJoin).toHaveBeenCalledTimes(1));

    act(() => {
      result.current.onMarkdownChange(() => "# Hello");
    });
    const settledCallCount = fetchMock.mock.calls.length;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 3000));
    });
    expect(fetchMock.mock.calls.length).toBe(settledCallCount);

    act(() => {
      result.current.onMarkdownChange(() => "# Hello\n\nedited");
    });
    await waitFor(
      () => {
        const saveCalls = fetchMock.mock.calls.filter(([, init]) => {
          const method = init?.method ?? "GET";
          return method === "PUT" || method === "POST";
        });
        expect(saveCalls.length).toBe(1);
      },
      { timeout: 5000 },
    );
  }, 15000);

  it("backs off collaboration GET retries across quick remounts", async () => {
    let collaborationGetCount = 0;
    const failingFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (method === "GET" && url.includes("/api/v1/files/collaboration")) {
        collaborationGetCount += 1;
        throw new TypeError("Failed to fetch");
      }
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", failingFetch);

    const first = renderHook(() =>
      useDocsCollab({
        userName: "Alex",
        autoJoin: true,
        urls: testUrls,
        wire,
      }),
    );
    await waitForCollabSession(first.result, 12000);
    await act(async () => {
      first.unmount();
    });

    const firstAttemptCount = collaborationGetCount;
    expect(firstAttemptCount).toBeGreaterThan(0);

    const second = renderHook(() =>
      useDocsCollab({
        userName: "Alex",
        autoJoin: true,
        urls: testUrls,
        wire,
      }),
    );
    await waitForCollabSession(second.result, 12000);
    expect(collaborationGetCount).toBe(firstAttemptCount);
  }, 20000);

  it("defers mesh join and document fetch until the auth token arrives, then joins", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("format=yjs")) {
        return new Response(null, { status: 204 });
      }
      if (init?.method === "PUT" || init?.method === "POST") {
        return new Response("{}", { status: 200 });
      }
      return new Response("# Hello", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const fetchAuthToken = vi.fn(async (input: { authToken?: string }) => input.authToken);
    const delayedWire: DocsCollabWireOperations = {
      fetchAuthToken,
      fetchRtcSettings: wire.fetchRtcSettings,
    };

    const { result, rerender } = renderHook(
      ({ authToken }: { authToken?: string }) =>
        useDocsCollab({
          userName: "Alex",
          autoJoin: true,
          urls: { ...testUrls, authToken },
          wire: delayedWire,
        }),
      { initialProps: { authToken: undefined } as { authToken?: string } },
    );

    await waitFor(() => expect(result.current.joined).toBe(true));
    await waitForCollabSession(result);
    expect(mockJoin).not.toHaveBeenCalled();
    const collabFetchesBeforeToken = fetchMock.mock.calls.filter(([input]) =>
      String(input).includes("/files/collaboration"),
    );
    expect(collabFetchesBeforeToken).toHaveLength(0);

    rerender({ authToken: "live-token" });

    await waitForCollabSession(result);
    await waitFor(() => expect(mockJoin).toHaveBeenCalledTimes(1));
    const authorizedCollabFetches = fetchMock.mock.calls.filter(([input, init]) => {
      if (!String(input).includes("/files/collaboration")) return false;
      const headers = (init as RequestInit | undefined)?.headers as
        Record<string, string> | undefined;
      return headers?.Authorization === "Bearer live-token";
    });
    expect(authorizedCollabFetches.length).toBeGreaterThan(0);
  });

  it("rebuilds from the outside text when the state is not an ancestor and nothing is unsaved", async () => {
    const stale = reconnectMarkerUpdate("stale-marker");
    const puts: Array<BodyInit | null | undefined> = [];
    const onExternalWrite = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.includes("format=yjs")) {
          return new Response(stale, {
            status: 200,
            headers: { ETag: '"stale"', "X-Wgw-External-Write": "1" },
          });
        }
        if (method === "PUT" || method === "POST") {
          puts.push(init?.body);
          return new Response("{}", { status: 200, headers: { ETag: '"saved"' } });
        }
        return new Response(JSON.stringify({ body: "from outside", title: "Outside" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    const { result } = renderHook(() =>
      useDocsCollab({
        userName: "Alex",
        autoJoin: true,
        urls: {
          ...testUrls,
          room: "note-external-rebuild",
          documentUrl: "/api/v1/notes/items/note-external-rebuild",
          yjsUrl: "/api/v1/notes/items/note-external-rebuild?format=yjs",
          onExternalWrite,
        },
        wire,
      }),
    );

    await waitForCollabSession(result);
    await waitFor(() => {
      const ydoc = result.current.session?.ydoc;
      expect(ydoc && readContentFromYDoc(ydoc)).toContain("from outside");
    });
    const ydoc = result.current.session?.ydoc;
    expect(ydoc && readContentFromYDoc(ydoc)).not.toContain("stale-marker");
    await waitFor(() => expect(puts.length).toBeGreaterThan(0));
    expect(markdownFromFramedSave(puts[0])).toBe("from outside");
    expect(onExternalWrite).not.toHaveBeenCalled();
  }, 15_000);

  it("asks before overwriting when an outside edit meets unsaved local work", async () => {
    const room = "note-external-prompt";
    const persistence = new IndexeddbPersistence(docsCollabIndexedDbKey(room), new Y.Doc());
    await persistence.whenSynced;
    await persistence.set(PENDING_SERVER_SAVE_KEY, 1);
    await persistence.destroy();

    const stale = reconnectMarkerUpdate("stale-marker");
    const puts: string[] = [];
    const onExternalWrite = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.includes("format=yjs")) {
          return new Response(stale, {
            status: 200,
            headers: { ETag: '"stale"', "X-Wgw-External-Write": "1" },
          });
        }
        if (method === "PUT" || method === "POST") {
          puts.push(String(init?.body ?? ""));
          return new Response("{}", { status: 200, headers: { ETag: '"saved"' } });
        }
        return new Response(JSON.stringify({ body: "from outside", title: "Outside" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    const { result } = renderHook(() =>
      useDocsCollab({
        userName: "Alex",
        autoJoin: true,
        urls: {
          ...testUrls,
          room,
          documentUrl: "/api/v1/notes/items/note-external-prompt",
          yjsUrl: "/api/v1/notes/items/note-external-prompt?format=yjs",
          onExternalWrite,
        },
        wire,
      }),
    );

    await waitForCollabSession(result);
    await waitFor(() =>
      expect(onExternalWrite).toHaveBeenCalledWith({
        markdown: "from outside",
        title: "Outside",
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(puts).toEqual([]);
    const ydoc = result.current.session?.ydoc;
    expect(ydoc && readContentFromYDoc(ydoc)).not.toContain("from outside");
  }, 15_000);

  it("merges two offline edits and does not ask", async () => {
    const room = "note-offline-merge";
    const persistence = new IndexeddbPersistence(docsCollabIndexedDbKey(room), new Y.Doc());
    await persistence.whenSynced;
    await persistence.set(PENDING_SERVER_SAVE_KEY, 1);
    await persistence.destroy();

    const update = reconnectMarkerUpdate("other-device");
    const listener = vi.fn();
    setDocsSyncConflictListener(listener);
    const onExternalWrite = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.includes("format=yjs")) {
          return new Response(update, { status: 200, headers: { ETag: '"snap"' } });
        }
        if (method === "PUT" || method === "POST" || method === "PATCH") {
          return new Response("{}", { status: 200, headers: { ETag: '"saved"' } });
        }
        return new Response("# from the other device", { status: 200 });
      }),
    );

    const { result } = renderHook(() =>
      useDocsCollab({
        userName: "Alex",
        autoJoin: true,
        urls: {
          ...testUrls,
          room,
          documentUrl: "/api/v1/notes/items/note-offline-merge",
          yjsUrl: "/api/v1/notes/items/note-offline-merge?format=yjs",
          onExternalWrite,
        },
        wire,
      }),
    );

    await waitForCollabSession(result);
    await waitFor(
      () => {
        expect(result.current.session?.ydoc.getText("reconnect-marker").toString()).toBe(
          "other-device",
        );
      },
      { timeout: 7000 },
    );
    expect(onExternalWrite).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    setDocsSyncConflictListener(undefined);
  }, 15_000);

  it("builds a note with no stored state from the markdown and does not ask", async () => {
    const onExternalWrite = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.includes("format=yjs")) return new Response(null, { status: 204 });
        if (method === "PUT" || method === "POST") {
          return new Response("{}", { status: 200, headers: { ETag: '"saved"' } });
        }
        return new Response(JSON.stringify({ body: "created outside", title: "New" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    const { result } = renderHook(() =>
      useDocsCollab({
        userName: "Alex",
        autoJoin: true,
        urls: {
          ...testUrls,
          room: "note-external-absent",
          documentUrl: "/api/v1/notes/items/note-external-absent",
          yjsUrl: "/api/v1/notes/items/note-external-absent?format=yjs",
          onExternalWrite,
        },
        wire,
      }),
    );

    await waitForCollabSession(result);
    await waitFor(() => {
      const ydoc = result.current.session?.ydoc;
      expect(ydoc && readContentFromYDoc(ydoc)).toContain("created outside");
    });
    expect(onExternalWrite).not.toHaveBeenCalled();
  }, 15_000);
});

function markdownFromFramedSave(body: BodyInit | null | undefined): string {
  const bytes = body instanceof Uint8Array ? body : null;
  if (!bytes) return "";
  const framed = decodeFramedPayload(bytes);
  if (
    !framed ||
    typeof framed.header !== "object" ||
    framed.header === null ||
    Array.isArray(framed.header)
  ) {
    return "";
  }
  const documentLen = (framed.header as { documentLen?: unknown }).documentLen;
  if (typeof documentLen !== "number") return "";
  return new TextDecoder().decode(framed.tail.subarray(0, documentLen));
}
