import "fake-indexeddb/auto";
import { StrictMode, useState, type ReactNode } from "react";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetConnectivityHubForTests } from "@/lib/offline/browser-online";
import { DEFAULT_RTC_SETTINGS } from "@/lib/rtc/types";
import {
  resetDocsCollabMeshLingerForTests,
  resumeDocsCollabMeshSession,
} from "./docs-collab-mesh-linger";
import type { DocsCollabSessionRefs } from "./docs-collab-types";
import type { DocsCollabWireOperations } from "./docs-collab-wire";
import { docsCollabRoomKey } from "./docs-collab-persistence";
import { useDocsCollab, resetDocsCollabBackoffForTests } from "./use-docs-collab";
import { useDocsCollabJoin } from "./use-docs-collab-join";
import { useDocsCollabMesh } from "./use-docs-collab-mesh";
import { useDocsCollabSave } from "./use-docs-collab-save";
import { useDocsCollabSessionRefs } from "./use-docs-collab-session-refs";

const ROOM = "docs/single-session.md";
const WAIT_MS = 5_000;

type JoinResult = { peerId: string; peers: [] };

type MockSession = {
  joined: boolean;
  left: boolean;
  join: ReturnType<typeof vi.fn<() => Promise<JoinResult>>>;
  leave: ReturnType<typeof vi.fn<() => Promise<void>>>;
  onMessage: ReturnType<typeof vi.fn>;
  getRoomPeers: ReturnType<typeof vi.fn>;
  clearMessageListeners: ReturnType<typeof vi.fn>;
};

const rtc = vi.hoisted(() => {
  const instances: MockSession[] = [];
  const pendingJoins: Array<(value: JoinResult) => void> = [];
  let autoResolveJoin = true;

  class MockDocsRtcSession {
    joined = false;

    left = false;

    onMessage = vi.fn();

    getRoomPeers = vi.fn(() => [] as { id: string; name: string }[]);

    getRoomPeerStatuses = vi.fn(() => [] as { id: string; name: string; link: string }[]);

    linkCount = vi.fn(() => 0);

    getMyId = vi.fn(() => "aaaaaaaaaaaaaaaa");

    getMyName = vi.fn(() => "Alex");

    getPeerIds = vi.fn(() => [] as string[]);

    clearMessageListeners = vi.fn();

    sendTo = vi.fn();

    broadcast = vi.fn();

    noteLocalUpdate = vi.fn();

    leave = vi.fn(async () => {
      this.left = true;
    });

    join = vi.fn(async () => {
      if (autoResolveJoin) {
        this.joined = true;
        return { peerId: "aaaaaaaaaaaaaaaa", peers: [] as [] };
      }
      return new Promise<JoinResult>((resolve) => {
        pendingJoins.push((value) => {
          this.joined = true;
          resolve(value);
        });
      });
    });

    constructor() {
      instances.push(this);
    }
  }

  return {
    instances,
    pendingJoins,
    MockDocsRtcSession,
    setAutoResolveJoin(next: boolean) {
      autoResolveJoin = next;
    },
    reset() {
      instances.length = 0;
      pendingJoins.length = 0;
      autoResolveJoin = true;
    },
  };
});

const captured = vi.hoisted(() => ({
  refs: null as DocsCollabSessionRefs | null,
}));

vi.mock("./docs-rtc-session", () => ({
  DocsRtcSession: vi.fn(rtc.MockDocsRtcSession),
}));

vi.mock("./use-docs-collab-session-refs", async () => {
  const actual = await vi.importActual<typeof import("./use-docs-collab-session-refs")>(
    "./use-docs-collab-session-refs",
  );
  return {
    ...actual,
    useDocsCollabSessionRefs: (wire: DocsCollabWireOperations, seedContent: string | undefined) => {
      const refs = actual.useDocsCollabSessionRefs(wire, seedContent);
      captured.refs = refs;
      return refs;
    },
  };
});

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

const testUrls = {
  room: ROOM,
  signalUrl: "/api/v1/rooms/events",
  collabApiBaseUrl: "/api/v1/rooms",
  collabRtcUrl: "/api/v1/rooms/configuration",
  documentUrl: "/api/v1/files/collaboration?path=docs%2Fsingle-session.md",
  yjsUrl: "/api/v1/files/collaboration?path=docs%2Fsingle-session.md&format=yjs",
  documentSaveMethod: "PUT" as const,
};

function joinCallCount(): number {
  return rtc.instances.reduce((sum, session) => sum + session.join.mock.calls.length, 0);
}

/** Identity check across the mocked session and the hook's real session type. */
function sameSession(left: unknown, right: unknown): boolean {
  return left === right;
}

function mockFetchResponses() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("format=yjs")) return new Response(null, { status: 204 });
    if (init?.method === "PUT" || init?.method === "POST")
      return new Response("{}", { status: 200 });
    return new Response("# Session\n", { status: 200 });
  });
}

type ProbeApi = {
  refs: DocsCollabSessionRefs;
  connect: (generation: number, name: string, authToken: string) => Promise<void>;
  teardown: () => void;
};

function ConnectProbe({
  wire,
  probe,
}: {
  wire: DocsCollabWireOperations;
  probe: { current: ProbeApi | null };
}) {
  const room = docsCollabRoomKey(ROOM);
  const refs = useDocsCollabSessionRefs(wire, undefined);
  const [, setDocStatus] = useState("");
  const save = useDocsCollabSave({
    refs,
    room,
    urls: testUrls,
    setDocStatus,
    setLastSavedAt: () => undefined,
    setPendingSync: () => undefined,
    setFailedSync: () => undefined,
  });
  const mesh = useDocsCollabMesh({
    refs,
    room,
    urls: testUrls,
    markDocReady: () => undefined,
    trySeedFromFile: () => undefined,
  });
  const join = useDocsCollabJoin({
    refs,
    room,
    urls: testUrls,
    userName: "Alex",
    mesh,
    save,
    setDocStatus,
    setLastSavedAt: () => undefined,
    setPendingSync: () => undefined,
    setFailedSync: () => undefined,
  });
  probe.current = {
    refs,
    connect: join.connectMeshInBackground,
    teardown: join.teardown,
  };
  return null;
}

describe("one DocsRtcSession per tab", () => {
  beforeEach(async () => {
    rtc.reset();
    captured.refs = null;
    resetDocsCollabMeshLingerForTests();
    resetConnectivityHubForTests();
    resetDocsCollabBackoffForTests();
    MockBroadcastChannel.peers = [];
    vi.stubGlobal("BroadcastChannel", MockBroadcastChannel);
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    vi.stubGlobal("fetch", mockFetchResponses());
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(ROOM);
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

  it("joins once when StrictMode remounts before rtc settings resolve", async () => {
    let resolveSettings: (value: typeof DEFAULT_RTC_SETTINGS) => void = () => undefined;
    const settings = new Promise<typeof DEFAULT_RTC_SETTINGS>((resolve) => {
      resolveSettings = resolve;
    });
    const wire: DocsCollabWireOperations = {
      fetchAuthToken: vi.fn(async () => "test-token"),
      fetchRtcSettings: vi.fn(() => settings),
    };

    const view = renderHook(
      () =>
        useDocsCollab({
          userName: "Alex",
          autoJoin: true,
          urls: testUrls,
          wire,
        }),
      { wrapper: ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode> },
    );

    await waitFor(() => expect(wire.fetchRtcSettings).toHaveBeenCalled(), { timeout: WAIT_MS });
    resolveSettings(DEFAULT_RTC_SETTINGS);

    await waitFor(() => expect(joinCallCount()).toBe(1), { timeout: WAIT_MS });
    const held = captured.refs?.meshRef.current;
    const parked = resumeDocsCollabMeshSession(ROOM);
    const joined = rtc.instances.filter((session) => session.joined && !session.left);
    expect(joined).toHaveLength(1);
    expect(sameSession(held, joined[0]) || sameSession(parked, joined[0])).toBe(true);
    expect(
      rtc.instances.filter(
        (session) =>
          session.joined &&
          !session.left &&
          !sameSession(session, held) &&
          !sameSession(session, parked),
      ),
    ).toEqual([]);

    view.unmount();
    resetDocsCollabMeshLingerForTests();
  });

  it("parks a session whose join resolves after unmount", async () => {
    rtc.setAutoResolveJoin(false);
    const wire: DocsCollabWireOperations = {
      fetchAuthToken: vi.fn(async () => "test-token"),
      fetchRtcSettings: vi.fn(async () => DEFAULT_RTC_SETTINGS),
    };
    const view = renderHook(() =>
      useDocsCollab({
        userName: "Alex",
        autoJoin: true,
        urls: testUrls,
        wire,
      }),
    );

    await waitFor(() => expect(joinCallCount()).toBe(1), { timeout: WAIT_MS });
    view.unmount();

    expect(captured.refs?.meshRef.current).toBeNull();
    const parked = resumeDocsCollabMeshSession(ROOM);
    expect(parked).toBe(rtc.instances[0]);
    expect(rtc.instances[0]?.leave).not.toHaveBeenCalled();

    const finish = rtc.pendingJoins.shift();
    finish?.({ peerId: "aaaaaaaaaaaaaaaa", peers: [] });
    await act(async () => {
      await Promise.resolve();
    });
    expect(captured.refs?.meshRef.current).toBeNull();
    expect(rtc.instances[0]?.leave).not.toHaveBeenCalled();
  });

  it("starts one join when connectMeshInBackground is called twice", async () => {
    let resolveSettings: (value: typeof DEFAULT_RTC_SETTINGS) => void = () => undefined;
    const settings = new Promise<typeof DEFAULT_RTC_SETTINGS>((resolve) => {
      resolveSettings = resolve;
    });
    const wire: DocsCollabWireOperations = {
      fetchAuthToken: vi.fn(async () => "test-token"),
      fetchRtcSettings: vi.fn(() => settings),
    };
    const probe: { current: ProbeApi | null } = { current: null };
    const view = render(<ConnectProbe wire={wire} probe={probe} />);

    const connect = probe.current?.connect;
    expect(connect).toBeTypeOf("function");
    const generation = probe.current?.refs.joinGenerationRef.current ?? 0;
    const first = connect?.(generation, "Alex", "test-token");
    const second = connect?.(generation, "Alex", "test-token");
    resolveSettings(DEFAULT_RTC_SETTINGS);
    await act(async () => {
      await Promise.all([first, second]);
    });

    expect(joinCallCount()).toBe(1);
    view.unmount();
  });
});
