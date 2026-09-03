import "fake-indexeddb/auto";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getConnectivitySnapshot,
  resetConnectivityHubForTests,
} from "@/lib/offline/browser-online";
import { DEFAULT_RTC_SETTINGS } from "@/lib/rtc/types";
import { resetDocsCollabMeshLingerForTests } from "./docs-collab-mesh-linger";
import type { DocsCollabWireOperations } from "./docs-collab-wire";
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

async function waitForCollabSession(result: { current: { session: unknown } }): Promise<void> {
  await waitFor(() => expect(result.current.session).not.toBeNull(), {
    timeout: SESSION_WAIT_MS,
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
    expect(mockJoin).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.status).toContain("Mesh"));
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
    await waitFor(() => expect(second.result.current.status).toContain("Mesh"));
    expect(mockJoin).toHaveBeenCalledTimes(1);
    expect(rtcMocks.mockLeave).not.toHaveBeenCalled();
  });

  it("exposes session before server fetch completes", async () => {
    let resolveMarkdown: ((value: Response) => void) | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("format=yjs")) {
        return new Response(null, { status: 204 });
      }
      if (init?.method === "PUT" || init?.method === "POST") {
        return new Response("{}", { status: 200 });
      }
      return new Promise<Response>((resolve) => {
        resolveMarkdown = resolve;
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
      resolveMarkdown?.(new Response("# Hello", { status: 200 }));
    });
  });

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
    expect(mockJoin).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("Connecting to mesh…");

    await act(async () => {
      resolveJoin?.({ peers: [] });
    });

    await waitFor(() => expect(result.current.status).toContain("Mesh"));
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
    await waitFor(() => expect(result.current.status).toContain("Mesh"), { timeout: 7000 });
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
    await waitFor(() => expect(result.current.status).toContain("Mesh"));
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
    await waitFor(() => expect(result.current.status).toContain("Mesh"), { timeout: 7000 });
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
    expect(mockJoin).toHaveBeenCalledTimes(1);

    rerender({ nextWire: makeWire() });
    await waitForCollabSession(result);
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
    await waitForCollabSession(first.result);
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
    await waitForCollabSession(second.result);
    expect(collaborationGetCount).toBe(firstAttemptCount);
  });

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
      { initialProps: { authToken: undefined } },
    );

    await waitForCollabSession(result);
    expect(mockJoin).not.toHaveBeenCalled();
    const collabFetchesBeforeToken = fetchMock.mock.calls.filter(([input]) =>
      String(input).includes("/files/collaboration"),
    );
    expect(collabFetchesBeforeToken).toHaveLength(0);

    rerender({ authToken: "live-token" });

    await waitFor(() => expect(mockJoin).toHaveBeenCalledTimes(1));
    const authorizedCollabFetches = fetchMock.mock.calls.filter(([input, init]) => {
      if (!String(input).includes("/files/collaboration")) return false;
      const headers = (init as RequestInit | undefined)?.headers as
        | Record<string, string>
        | undefined;
      return headers?.Authorization === "Bearer live-token";
    });
    expect(authorizedCollabFetches.length).toBeGreaterThan(0);
  });
});
