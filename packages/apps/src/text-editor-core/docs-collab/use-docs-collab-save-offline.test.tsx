/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MutableRefObject } from "react";
import * as Y from "yjs";
import type { DocsCollabSessionRefs } from "./docs-collab-types";

const persistCollabSave = vi.hoisted(() => vi.fn());

const online = vi.hoisted(() => ({ value: true }));

vi.mock("@/lib/offline/browser-online", () => ({
  getConnectivitySnapshot: () => online.value,
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

describe("useDocsCollabSave offline", () => {
  beforeEach(() => {
    online.value = false;
    persistCollabSave.mockReset();
  });

  afterEach(() => {
    online.value = true;
  });

  it("marks an edit back to the last known text unsaved (a note emptied offline)", async () => {
    const refs = sessionRefs();
    // The Y.Doc listener saw the local edit; the text equals the initial "".
    refs.localDirtySinceLastSaveRef.current = true;
    refs.lastKnownMarkdownRef.current = "";
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

    await act(async () => {
      result.current.onMarkdownChange(() => "");
      await Promise.resolve();
    });

    expect(refs.persistenceRef.current?.set).toHaveBeenCalledWith("pendingServerSave", 1);
  });
});
