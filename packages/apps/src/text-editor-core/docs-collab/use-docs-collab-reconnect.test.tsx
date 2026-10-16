/** @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MutableRefObject } from "react";
import * as Y from "yjs";
import type { DocsCollabSessionRefs, DocsCollabUrls } from "./docs-collab-types";
import { resetDocsCollabBackoffForTests } from "./docs-collab-room-backoff";

vi.mock("@/lib/api/wgw/http", () => ({
  wgwHasAuthenticatedSession: () => false,
  wgwAwaitSessionRefreshForReconnect: vi.fn(async () => undefined),
  wgwEnsureFreshAccessToken: vi.fn(async () => null),
}));

import { useDocsCollabReconnect } from "./use-docs-collab-reconnect";

function ref<T>(value: T): MutableRefObject<T> {
  return { current: value };
}

function sessionRefs(
  kind: DocsCollabSessionRefs["saveTerminalKindRef"]["current"],
): DocsCollabSessionRefs {
  return {
    meshRef: ref(null),
    ydocRef: ref(new Y.Doc()),
    awarenessRef: ref(null),
    persistenceRef: ref({ get: vi.fn(async () => undefined) } as never),
    pendingMarkdownRef: ref(""),
    seedDoneRef: ref(false),
    saveTimerRef: ref(null),
    seedTimerRef: ref(null),
    getMarkdownRef: ref(() => ""),
    joinGenerationRef: ref(0),
    reconnectGenerationRef: ref(0),
    authTokenRef: ref(undefined),
    failedSinceRef: ref(new Map()),
    saveFailedRef: ref(false),
    wireRef: ref({ fetchAuthToken: vi.fn(async () => "token") } as never),
    seedContentRef: ref(undefined),
    joinedRoomRef: ref(null),
    reconnectInFlightRef: ref(false),
    saveInFlightRef: ref(false),
    saveRetryMsRef: ref(Number.POSITIVE_INFINITY),
    nextSaveAttemptAtRef: ref(Number.POSITIVE_INFINITY),
    saveTerminalKindRef: ref(kind),
    localDirtySinceLastSaveRef: ref(false),
    pendingServerSaveRef: ref(true),
    externalWriteHoldRef: ref(false),
    markdownOverrideRef: ref(null),
    lastKnownMarkdownRef: ref(""),
    lastSuccessfulSaveSignatureRef: ref(null),
    sessionRef: ref(null),
    tabSyncRef: ref(null),
  };
}

const urls: DocsCollabUrls = {
  signalUrl: "/events",
  documentUrl: "/files/collaboration?path=users%2Fada%2Fnote.md",
  yjsUrl: "/files/collaboration?path=users%2Fada%2Fnote.md&format=yjs",
  room: "users/ada/note.md",
};

describe("useDocsCollabReconnect save gate", () => {
  beforeEach(() => {
    resetDocsCollabBackoffForTests();
  });

  it("clears a 403 gate so a restored ACL can save", async () => {
    const refs = sessionRefs("forbidden");
    const persistToServer = vi.fn(async () => undefined);
    const { result } = renderHook(() =>
      useDocsCollabReconnect({
        refs,
        room: "users/ada/note.md",
        urls,
        userName: "Ada",
        joined: true,
        mesh: {
          joinMesh: vi.fn(async () => []),
          refreshMeshUi: vi.fn(),
          setStatus: vi.fn(),
          setConnectingPeers: vi.fn(),
        },
        save: { persistToServer, flushPendingSaveIfReady: vi.fn() },
        join: { trySeedFromFile: vi.fn(), mergeServerState: vi.fn(async () => undefined) },
        setDocStatus: vi.fn(),
      }),
    );

    await result.current.handleReconnect();

    expect(refs.saveTerminalKindRef.current).toBeNull();
    expect(refs.nextSaveAttemptAtRef.current).toBe(0);
    expect(persistToServer).toHaveBeenCalledTimes(1);
  });

  it("leaves a 404 gate in place", async () => {
    const refs = sessionRefs("gone");
    const persistToServer = vi.fn(async () => undefined);
    const { result } = renderHook(() =>
      useDocsCollabReconnect({
        refs,
        room: "users/ada/note.md",
        urls,
        userName: "Ada",
        joined: true,
        mesh: {
          joinMesh: vi.fn(async () => []),
          refreshMeshUi: vi.fn(),
          setStatus: vi.fn(),
          setConnectingPeers: vi.fn(),
        },
        save: { persistToServer, flushPendingSaveIfReady: vi.fn() },
        join: { trySeedFromFile: vi.fn(), mergeServerState: vi.fn(async () => undefined) },
        setDocStatus: vi.fn(),
      }),
    );

    await result.current.handleReconnect();

    expect(refs.saveTerminalKindRef.current).toBe("gone");
    expect(refs.nextSaveAttemptAtRef.current).toBe(Number.POSITIVE_INFINITY);
    expect(persistToServer).not.toHaveBeenCalled();
  });
});
