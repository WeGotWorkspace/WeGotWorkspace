/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MutableRefObject } from "react";
import * as Y from "yjs";
import type { DocsCollabSessionRefs } from "./docs-collab-types";
import { SAVE_DELAY_MS, SAVE_MAX_WAIT_MS } from "./docs-collab-save-queue";
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

describe("useDocsCollabSave while someone keeps typing (#1533)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    persistCollabSave.mockReset();
    persistCollabSave.mockImplementation(async ({ markdown }: { markdown: string }) => ({
      status: "saved",
      markdown,
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function renderSave(refs: DocsCollabSessionRefs) {
    return renderHook(() =>
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
  }

  it("saves at most SAVE_MAX_WAIT_MS after the first keystroke, not only once typing stops", async () => {
    const refs = sessionRefs();
    refs.localDirtySinceLastSaveRef.current = false;
    const { result } = renderSave(refs);
    let text = "";
    const savedAt: number[] = [];
    const start = Date.now();
    persistCollabSave.mockImplementation(async ({ markdown }: { markdown: string }) => {
      savedAt.push(Date.now() - start);
      return { status: "saved", markdown };
    });

    // A keystroke every 400 ms for 10 s: each one alone would push a plain debounce back.
    for (let i = 0; i < 25; i++) {
      text += "a";
      const typed = text;
      act(() => result.current.onMarkdownChange(() => typed));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });
    }

    expect(savedAt[0]).toBeLessThanOrEqual(SAVE_MAX_WAIT_MS);
    expect(savedAt.length).toBeGreaterThanOrEqual(3);
  });

  it("still waits for a pause when there is only one keystroke", async () => {
    const refs = sessionRefs();
    refs.localDirtySinceLastSaveRef.current = false;
    const { result } = renderSave(refs);
    act(() => result.current.onMarkdownChange(() => "one"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS - 1);
    });
    expect(persistCollabSave).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(persistCollabSave).toHaveBeenCalledTimes(1);
  });

  it("saves text typed while the previous save was on its way", async () => {
    const refs = sessionRefs();
    refs.localDirtySinceLastSaveRef.current = false;
    const { result } = renderSave(refs);
    let finishFirst: () => void = () => undefined;
    persistCollabSave.mockImplementationOnce(
      ({ markdown }: { markdown: string }) =>
        new Promise((resolve) => {
          finishFirst = () => resolve({ status: "saved", markdown });
        }),
    );

    act(() => result.current.onMarkdownChange(() => "first"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    });
    expect(persistCollabSave).toHaveBeenCalledTimes(1);

    // Typed during the save; its own timer fires while that save still runs.
    act(() => result.current.onMarkdownChange(() => "first and more"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVE_MAX_WAIT_MS + 500);
    });
    finishFirst();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVE_MAX_WAIT_MS + 500);
    });

    expect(persistCollabSave).toHaveBeenCalledTimes(2);
    expect(persistCollabSave.mock.calls[1]?.[0]).toMatchObject({ markdown: "first and more" });
    expect(refs.localDirtySinceLastSaveRef.current).toBe(false);
  });
});
