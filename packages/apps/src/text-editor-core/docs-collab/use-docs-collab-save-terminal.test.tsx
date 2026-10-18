/** @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MutableRefObject } from "react";
import * as Y from "yjs";
import type { DocsCollabSessionRefs, DocsCollabUrls } from "./docs-collab-types";
import { CollabHttpError } from "./docs-collab-utils";
import { DOC_STATUS_ACCESS_LOST, DOC_STATUS_DOCUMENT_GONE } from "./docs-collab-status";

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
  const ydoc = new Y.Doc();
  return {
    meshRef: ref(null),
    ydocRef: ref(ydoc),
    awarenessRef: ref(null),
    persistenceRef: ref({
      set: vi.fn(async () => undefined),
      del: vi.fn(async () => undefined),
    } as never),
    pendingMarkdownRef: ref(""),
    seedDoneRef: ref(false),
    saveTimerRef: ref(null),
    seedTimerRef: ref(null),
    getMarkdownRef: ref(() => "local copy"),
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

function urls(extra: Partial<DocsCollabUrls>): DocsCollabUrls {
  return {
    signalUrl: "/events",
    documentUrl: "/files/collaboration?path=users%2Fada%2Fgone.md",
    yjsUrl: "/files/collaboration?path=users%2Fada%2Fgone.md&format=yjs",
    room: "users/ada/gone.md",
    ...extra,
  };
}

describe("useDocsCollabSave terminal failures", () => {
  beforeEach(() => {
    persistCollabSave.mockReset();
  });

  it("stops retrying a deleted document and offers the local copy", async () => {
    persistCollabSave.mockRejectedValue(new CollabHttpError("PATCH failed (404)", 404));
    const refs = sessionRefs();
    const onDocumentGone = vi.fn();
    const setDocStatus = vi.fn();
    const { result } = renderHook(() =>
      useDocsCollabSave({
        refs,
        room: "users/ada/gone.md",
        urls: urls({ onDocumentGone }),
        setDocStatus,
        setLastSavedAt: vi.fn(),
        setPendingSync: vi.fn(),
        setFailedSync: vi.fn(),
      }),
    );

    await expect(result.current.persistToServer()).rejects.toThrow(/404/);
    expect(onDocumentGone).toHaveBeenCalledTimes(1);
    expect(setDocStatus).toHaveBeenCalledWith(DOC_STATUS_DOCUMENT_GONE);
    expect(refs.saveTerminalKindRef.current).toBe("gone");
    expect(refs.saveRetryMsRef.current).toBe(Number.POSITIVE_INFINITY);
    expect(refs.nextSaveAttemptAtRef.current).toBe(Number.POSITIVE_INFINITY);
    expect(refs.pendingServerSaveRef.current).toBe(true);

    await result.current.persistToServer();
    expect(persistCollabSave).toHaveBeenCalledTimes(1);
  });

  it("gives a notice when a save is revoked and does not keep retrying", async () => {
    persistCollabSave.mockRejectedValue(new CollabHttpError("PATCH failed (403)", 403));
    const refs = sessionRefs();
    const onPersistForbidden = vi.fn();
    const onDocumentGone = vi.fn();
    const setDocStatus = vi.fn();
    const { result } = renderHook(() =>
      useDocsCollabSave({
        refs,
        room: "users/ada/gone.md",
        urls: urls({ onPersistForbidden, onDocumentGone }),
        setDocStatus,
        setLastSavedAt: vi.fn(),
        setPendingSync: vi.fn(),
        setFailedSync: vi.fn(),
      }),
    );

    await expect(result.current.persistToServer()).rejects.toThrow(/403/);
    expect(onPersistForbidden).toHaveBeenCalledTimes(1);
    expect(onDocumentGone).not.toHaveBeenCalled();
    expect(setDocStatus).toHaveBeenCalledWith(DOC_STATUS_ACCESS_LOST);
    expect(refs.saveTerminalKindRef.current).toBe("forbidden");
    expect(refs.nextSaveAttemptAtRef.current).toBe(Number.POSITIVE_INFINITY);
    expect(refs.pendingServerSaveRef.current).toBe(true);
  });
});
