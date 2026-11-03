/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MutableRefObject } from "react";
import * as Y from "yjs";
import type { DocsCollabSessionRefs } from "./docs-collab-types";
import { CollabHttpError } from "./docs-collab-utils";

const persistCollabSave = vi.hoisted(() => vi.fn());

vi.mock("@/lib/offline/browser-online", () => ({
  getConnectivitySnapshot: () => true,
}));

vi.mock("./docs-collab-save-attempt", () => ({
  persistCollabSave,
}));

import { useDocsCollabSave } from "./use-docs-collab-save";

function ref<T>(value: T): MutableRefObject<T> {
  return { current: value };
}

function sessionRefs(): DocsCollabSessionRefs {
  return {
    meshRef: ref(null),
    ydocRef: ref(new Y.Doc()),
    awarenessRef: ref(null),
    persistenceRef: ref({
      set: vi.fn(async () => undefined),
      del: vi.fn(async () => undefined),
    } as never),
    pendingMarkdownRef: ref(""),
    seedDoneRef: ref(false),
    saveTimerRef: ref(null),
    seedTimerRef: ref(null),
    getMarkdownRef: ref(() => "typed while the server hiccuped"),
    joinGenerationRef: ref(0),
    reconnectGenerationRef: ref(0),
    authTokenRef: ref(undefined),
    failedSinceRef: ref(new Map()),
    saveFailedRef: ref(false),
    wireRef: ref({} as never),
    seedContentRef: ref(undefined),
    joinedRoomRef: ref(null),
    reconnectInFlightRef: ref(false),
    saveInFlightRef: ref(false),
    saveRetryMsRef: ref(0),
    nextSaveAttemptAtRef: ref(0),
    saveTerminalKindRef: ref(null),
    localDirtySinceLastSaveRef: ref(true),
    pendingServerSaveRef: ref(false),
    externalWriteHoldRef: ref(false),
    externalWriteSeenRef: ref<string | null>(null),
    markdownOverrideRef: ref(null),
    lastKnownMarkdownRef: ref(""),
    lastSuccessfulSaveSignatureRef: ref(null),
    sessionRef: ref(null),
    tabSyncRef: ref(null),
  };
}

describe("useDocsCollabSave after a failed save", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    persistCollabSave.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("tries again on its own once the backoff has passed", async () => {
    // A 500 (e.g. SQLite busy) must not leave the body unsaved until the next keystroke.
    persistCollabSave
      .mockRejectedValueOnce(new CollabHttpError("PUT failed (500)", 500))
      .mockResolvedValue({ status: "saved", markdown: "typed while the server hiccuped" });
    const refs = sessionRefs();
    const { result } = renderHook(() =>
      useDocsCollabSave({
        refs,
        room: "note-uid-1",
        urls: { signalUrl: "/events", documentUrl: "/notes/items/1", yjsUrl: "/y", room: "n1" },
        setDocStatus: vi.fn(),
        setLastSavedAt: vi.fn(),
        setPendingSync: vi.fn(),
        setFailedSync: vi.fn(),
      }),
    );

    act(() => result.current.scheduleSave());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(persistCollabSave).toHaveBeenCalledTimes(2);
    expect(refs.pendingServerSaveRef.current).toBe(false);
  });
});
