import "fake-indexeddb/auto";
import { StrictMode, type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RTC_SETTINGS } from "@/lib/rtc/types";
import {
  resetDocsCollabMeshLingerForTests,
  resumeDocsCollabMeshSession,
} from "./docs-collab-mesh-linger";
import { resetDocsCollabBackoffForTests } from "./docs-collab-room-backoff";
import type { DocsCollabWireOperations } from "./docs-collab-wire";
import { DEFAULT_DOCS_COLLAB_URLS, useDocsCollab } from "./use-docs-collab";

const rtcMocks = vi.hoisted(() => ({
  sessions: [] as Array<{
    left: boolean;
    join: ReturnType<typeof vi.fn>;
    leave: ReturnType<typeof vi.fn>;
  }>,
  resolveJoin: null as (() => void) | null,
  joinCalls: 0,
}));

vi.mock("./docs-rtc-session", () => ({
  DocsRtcSession: class {
    left = false;

    join = vi.fn(
      () =>
        new Promise<{ peerId: string; peers: [] }>((resolve) => {
          rtcMocks.joinCalls += 1;
          rtcMocks.resolveJoin = () => resolve({ peerId: "peer-a", peers: [] });
        }),
    );

    leave = vi.fn(async () => {
      this.left = true;
    });

    onMessage = vi.fn();

    getRoomPeers = vi.fn(() => [] as { id: string; name: string }[]);

    getPeerIds = vi.fn(() => [] as string[]);

    getMyId = vi.fn(() => "peer-a");

    clearMessageListeners = vi.fn();

    broadcast = vi.fn();

    constructor() {
      rtcMocks.sessions.push(this);
    }
  },
}));

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

const ROOM = "docs/single-session.md";

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("one collab session per tab", () => {
  let settings: ReturnType<typeof deferred<typeof DEFAULT_RTC_SETTINGS>>;

  beforeEach(() => {
    rtcMocks.sessions = [];
    rtcMocks.resolveJoin = null;
    rtcMocks.joinCalls = 0;
    settings = deferred<typeof DEFAULT_RTC_SETTINGS>();
    resetDocsCollabMeshLingerForTests();
    resetDocsCollabBackoffForTests();
    vi.stubGlobal("BroadcastChannel", MockBroadcastChannel);
    MockBroadcastChannel.peers = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("format=yjs")) return new Response(null, { status: 204 });
        return new Response("# Hello", { status: 200 });
      }),
    );
  });

  afterEach(() => {
    resetDocsCollabMeshLingerForTests();
    vi.unstubAllGlobals();
  });

  function wire(): DocsCollabWireOperations {
    return {
      fetchAuthToken: vi.fn(async () => "test-token"),
      fetchRtcSettings: vi.fn(() => settings.promise),
    };
  }

  function renderCollab(strict: boolean) {
    const wrapper = strict
      ? ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>
      : undefined;
    return renderHook(
      () =>
        useDocsCollab({
          userName: "Alex",
          autoJoin: true,
          urls: {
            ...DEFAULT_DOCS_COLLAB_URLS,
            room: ROOM,
            documentUrl: "/api/v1/files/collaboration?path=docs%2Fsingle-session.md",
            yjsUrl: "/api/v1/files/collaboration?path=docs%2Fsingle-session.md&format=yjs",
          },
          wire: wire(),
        }),
      { wrapper },
    );
  }

  it("joins once when StrictMode remounts while settings are still loading", async () => {
    const { unmount } = renderCollab(true);
    await act(async () => {
      await Promise.resolve();
    });
    settings.resolve({ ...DEFAULT_RTC_SETTINGS });
    await waitFor(() => expect(rtcMocks.joinCalls).toBe(1), { timeout: 5_000 });
    rtcMocks.resolveJoin?.();
    await act(async () => {
      await Promise.resolve();
    });
    expect(rtcMocks.sessions.filter((session) => !session.left)).toHaveLength(1);
    unmount();
  });

  it("parks a session whose join resolves after unmount", async () => {
    settings.resolve({ ...DEFAULT_RTC_SETTINGS });
    const { unmount } = renderCollab(false);
    await waitFor(() => expect(rtcMocks.joinCalls).toBe(1), { timeout: 5_000 });
    const session = rtcMocks.sessions[0];
    unmount();
    rtcMocks.resolveJoin?.();
    await act(async () => {
      await Promise.resolve();
    });
    expect(session?.left).toBe(false);
    expect(resumeDocsCollabMeshSession(ROOM)).toBe(session);
  });

  it("uses one join when connectMeshInBackground is called twice", async () => {
    const { result } = renderHook(() =>
      useDocsCollab({
        userName: "Alex",
        autoJoin: false,
        urls: {
          ...DEFAULT_DOCS_COLLAB_URLS,
          room: ROOM,
          documentUrl: "/api/v1/files/collaboration?path=docs%2Fsingle-session.md",
          yjsUrl: "/api/v1/files/collaboration?path=docs%2Fsingle-session.md&format=yjs",
        },
        wire: wire(),
      }),
    );
    await act(async () => {
      const first = result.current.connectMeshInBackground(0, "Alex", "test-token");
      const second = result.current.connectMeshInBackground(0, "Alex", "test-token");
      settings.resolve({ ...DEFAULT_RTC_SETTINGS });
      await Promise.resolve();
      await Promise.resolve();
      rtcMocks.resolveJoin?.();
      await Promise.all([first, second]);
    });
    expect(rtcMocks.joinCalls).toBe(1);
  });
});
