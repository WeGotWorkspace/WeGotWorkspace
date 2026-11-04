/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppToastShowOptions } from "@/hooks/use-app-toast";
import {
  useQueuedMutation,
  type IrreversibleWriteArgs,
  type ReversibleWriteArgs,
} from "@/hooks/use-queued-mutation";
import { resetWgwSessionStateForTests, wgwFetch } from "@/lib/api/wgw/http";

const toast = vi.hoisted(() => ({
  show: vi.fn((_title: string, _options?: unknown) => "toast-1" as string | number),
  dismiss: vi.fn(),
}));

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({
    show: toast.show,
    dismiss: toast.dismiss,
    showSuccess: vi.fn(),
    showError: vi.fn(),
  }),
}));

const DELAY_MS = 2500;

/** An irreversible (deferred) write, like a hard delete. */
function queueArgs(overrides: Partial<IrreversibleWriteArgs> = {}): IrreversibleWriteArgs {
  return {
    key: "drive:delete:file-1",
    toastMessage: "Deleted",
    irreversible: true,
    execute: vi.fn(async () => undefined),
    undo: vi.fn(),
    undoToastMessage: "Star change undone.",
    ...overrides,
  };
}

function renderQueue() {
  return renderHook(() => useQueuedMutation({ delayMs: DELAY_MS, onMutationError: vi.fn() }));
}

function lastToastUndo(): () => void {
  const options = toast.show.mock.calls.at(-1)?.[1] as AppToastShowOptions | undefined;
  if (!options?.onUndo) throw new Error("no undo toast shown");
  return options.onUndo;
}

type FetchMock = ReturnType<
  typeof vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>
>;

/** Runs `run` with a member session and a fetch stub that answers 204, on real timers. */
async function withSignedInFetch(run: (fetchMock: FetchMock) => Promise<void>) {
  vi.useRealTimers();
  resetWgwSessionStateForTests();
  window.localStorage.setItem("wgw.api.access_token", "token-1");
  window.localStorage.setItem("wgw.api.session_kind", "member");
  window.localStorage.setItem("wgw.api.access_expires_at", String(Date.now() + 3_600_000));
  const originalFetch = globalThis.fetch;
  const fetchMock: FetchMock = vi.fn(async () => new Response(null, { status: 204 }));
  globalThis.fetch = fetchMock as typeof fetch;
  try {
    await run(fetchMock);
  } finally {
    globalThis.fetch = originalFetch;
    window.localStorage.clear();
    resetWgwSessionStateForTests();
  }
}

function firePageExit(type: "pagehide" | "beforeunload") {
  act(() => {
    window.dispatchEvent(new Event(type, { cancelable: true }));
  });
}

/** Runs `run` while a leave prompt (like Meet's) cancels `beforeunload`. */
function withLeavePrompt(run: () => void) {
  const prompt = (event: Event) => event.preventDefault();
  window.addEventListener("beforeunload", prompt);
  try {
    run();
  } finally {
    window.removeEventListener("beforeunload", prompt);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  toast.show.mockClear();
  toast.dismiss.mockClear();
});

afterEach(() => {
  window.dispatchEvent(new Event("pageshow"));
  vi.useRealTimers();
});

describe("useQueuedMutation irreversible write when the page is left", () => {
  it("sends a pending write right away when the page is hidden", () => {
    const { result } = renderQueue();
    const args = queueArgs();

    act(() => result.current.queueMutation(args));
    expect(args.execute).not.toHaveBeenCalled();

    firePageExit("pagehide");

    expect(args.execute).toHaveBeenCalledTimes(1);
  });

  it("sends a pending write right away on beforeunload", () => {
    const { result } = renderQueue();
    const args = queueArgs();

    act(() => result.current.queueMutation(args));
    firePageExit("beforeunload");

    expect(args.execute).toHaveBeenCalledTimes(1);
  });

  it("keeps the write and its Undo when a leave prompt cancels beforeunload", () => {
    const { result } = renderQueue();
    const args = queueArgs();

    withLeavePrompt(() => {
      act(() => result.current.queueMutation(args));
      firePageExit("beforeunload");
    });
    expect(args.execute).not.toHaveBeenCalled();

    act(() => {
      lastToastUndo()();
    });
    act(() => {
      vi.advanceTimersByTime(DELAY_MS * 2);
    });

    expect(args.execute).not.toHaveBeenCalled();
    expect(args.undo).toHaveBeenCalledTimes(1);
  });

  it("sends without keepalive after the user stays on a leave prompt", async () => {
    await withSignedInFetch(async (fetchMock) => {
      const { result } = renderHook(() =>
        useQueuedMutation({ delayMs: 50, onMutationError: vi.fn() }),
      );
      withLeavePrompt(() => {
        act(() =>
          result.current.queueMutation(
            queueArgs({
              execute: async (signal) => {
                await wgwFetch("/files/star?path=a.txt", { method: "DELETE", signal });
              },
            }),
          ),
        );
        firePageExit("beforeunload");
      });

      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      expect(fetchMock.mock.calls[0]?.[1]?.keepalive).toBeFalsy();
    });
  });

  it("sends the write once when beforeunload, pagehide and the timer all fire", () => {
    const { result } = renderQueue();
    const args = queueArgs();

    act(() => result.current.queueMutation(args));
    firePageExit("beforeunload");
    firePageExit("pagehide");
    act(() => {
      vi.advanceTimersByTime(DELAY_MS * 2);
    });

    expect(args.execute).toHaveBeenCalledTimes(1);
  });

  it("does not send a write the user undid", () => {
    const { result } = renderQueue();
    const args = queueArgs();

    act(() => result.current.queueMutation(args));
    act(() => {
      lastToastUndo()();
    });
    firePageExit("pagehide");

    expect(args.execute).not.toHaveBeenCalled();
    expect(args.undo).toHaveBeenCalledTimes(1);
  });

  it("sends the write with keepalive so it survives the page unloading", async () => {
    await withSignedInFetch(async (fetchMock) => {
      const { result } = renderQueue();
      act(() =>
        result.current.queueMutation(
          queueArgs({
            execute: async (signal) => {
              await wgwFetch("/files/star?path=a.txt", { method: "DELETE", signal });
            },
          }),
        ),
      );

      firePageExit("pagehide");

      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      expect(fetchMock.mock.calls[0]?.[1]?.keepalive).toBe(true);
    });
  });
});

describe("useQueuedMutation irreversible write when the list unmounts", () => {
  it("keeps the pending write and sends it after the delay", () => {
    const { result, unmount } = renderQueue();
    const args = queueArgs();

    act(() => result.current.queueMutation(args));
    unmount();
    expect(toast.dismiss).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(DELAY_MS);
    });

    expect(args.execute).toHaveBeenCalledTimes(1);
  });

  it("still lets the user undo from the toast", () => {
    const { result, unmount } = renderQueue();
    const args = queueArgs();

    act(() => result.current.queueMutation(args));
    unmount();
    act(() => {
      lastToastUndo()();
    });
    act(() => {
      vi.advanceTimersByTime(DELAY_MS * 2);
    });

    expect(args.execute).not.toHaveBeenCalled();
    expect(args.undo).toHaveBeenCalledTimes(1);
  });

  it("does not abort a write that is already being sent", () => {
    const { result, unmount } = renderQueue();
    let signal: AbortSignal | null = null;
    const args = queueArgs({
      execute: vi.fn((received: AbortSignal) => {
        signal = received;
        return new Promise<void>(() => undefined);
      }),
    });

    act(() => result.current.queueMutation(args));
    act(() => {
      vi.advanceTimersByTime(DELAY_MS);
    });
    unmount();

    expect(signal).not.toBeNull();
    expect(signal!.aborted).toBe(false);
  });

  it("sends a write queued before the unmount when the page is hidden", () => {
    const { result, unmount } = renderQueue();
    const args = queueArgs();

    act(() => result.current.queueMutation(args));
    unmount();
    firePageExit("pagehide");

    expect(args.execute).toHaveBeenCalledTimes(1);
  });
});

describe("useQueuedMutation keepalive budget", () => {
  it("leaves out keepalive for a body too large for the browser limit", async () => {
    await withSignedInFetch(async (fetchMock) => {
      const { result } = renderQueue();
      act(() =>
        result.current.queueMutation(
          queueArgs({
            execute: async (signal) => {
              await wgwFetch("/notes/1", {
                method: "PUT",
                body: "x".repeat(70 * 1024),
                signal,
              });
              await wgwFetch("/files/star?path=a.txt", { method: "DELETE", signal });
            },
          }),
        ),
      );

      firePageExit("pagehide");

      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      expect(fetchMock.mock.calls[0]?.[1]?.keepalive).toBeFalsy();
      expect(fetchMock.mock.calls[1]?.[1]?.keepalive).toBe(true);
    });
  });
});

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function reversibleArgs(overrides: Partial<ReversibleWriteArgs> = {}): ReversibleWriteArgs {
  return {
    key: "notes:star:note-1",
    toastMessage: "Starred",
    execute: vi.fn(async () => undefined),
    revert: vi.fn(async () => undefined),
    undo: vi.fn(),
    undoToastMessage: "Star change undone.",
    ...overrides,
  };
}

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe("useQueuedMutation reversible write", () => {
  it("sends the write right away, without waiting for the grace period", () => {
    const { result } = renderQueue();
    const args = reversibleArgs();

    act(() => result.current.queueMutation(args));

    expect(args.execute).toHaveBeenCalledTimes(1);
  });

  it("sends the revert on Undo after the write landed", async () => {
    const { result } = renderQueue();
    const args = reversibleArgs();

    act(() => result.current.queueMutation(args));
    await settle();
    act(() => lastToastUndo()());
    await settle();

    expect(args.undo).toHaveBeenCalledTimes(1);
    expect(args.revert).toHaveBeenCalledWith(null);
  });

  it("waits for the write to settle before reverting", async () => {
    const { result } = renderQueue();
    const write = deferred();
    let signal: AbortSignal | null = null;
    const args = reversibleArgs({
      execute: vi.fn((received: AbortSignal) => {
        signal = received;
        return write.promise;
      }),
    });

    act(() => result.current.queueMutation(args));
    act(() => lastToastUndo()());
    await settle();

    expect(args.undo).toHaveBeenCalledTimes(1);
    expect(args.revert).not.toHaveBeenCalled();
    // A request already sent is not aborted: it may land on the server anyway.
    expect(signal!.aborted).toBe(false);

    write.resolve();
    await settle();

    expect(args.revert).toHaveBeenCalledTimes(1);
  });

  it("does not revert a single write that failed", async () => {
    const onMutationError = vi.fn();
    const { result } = renderHook(() => useQueuedMutation({ delayMs: DELAY_MS, onMutationError }));
    const onError = vi.fn();
    const args = reversibleArgs({
      execute: vi.fn(async () => {
        throw new Error("500");
      }),
      onError,
    });

    act(() => result.current.queueMutation(args));
    await settle();
    act(() => lastToastUndo()());
    await settle();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onMutationError).toHaveBeenCalledTimes(1);
    expect(args.revert).not.toHaveBeenCalled();
    expect(args.undo).not.toHaveBeenCalled();
  });

  it("reverts the items a failed batch already applied", async () => {
    const { result } = renderQueue();
    const args = reversibleArgs({
      execute: vi.fn(async (_signal: AbortSignal, markCompleted: (key: string) => void) => {
        markCompleted("a");
        throw new Error("500 on b");
      }),
    });

    act(() => result.current.queueMutation(args));
    await settle();

    expect(args.revert).toHaveBeenCalledWith(new Set(["a"]));
  });

  it("reverts only the marked items of a batch on Undo", async () => {
    const { result } = renderQueue();
    const args = reversibleArgs({
      execute: vi.fn(async (_signal: AbortSignal, markCompleted: (key: string) => void) => {
        markCompleted("a");
        markCompleted("b");
      }),
    });

    act(() => result.current.queueMutation(args));
    await settle();
    act(() => lastToastUndo()());
    await settle();

    expect(args.revert).toHaveBeenCalledWith(new Set(["a", "b"]));
  });

  it("reverts once when Undo is pressed twice", async () => {
    const { result } = renderQueue();
    const args = reversibleArgs();

    act(() => result.current.queueMutation(args));
    await settle();
    const undo = lastToastUndo();
    act(() => undo());
    act(() => undo());
    await settle();

    expect(args.revert).toHaveBeenCalledTimes(1);
    expect(args.undo).toHaveBeenCalledTimes(1);
  });

  it("keeps Undo for the whole window after the write landed", async () => {
    const { result } = renderQueue();
    const args = reversibleArgs();

    act(() => result.current.queueMutation(args));
    await settle();
    act(() => {
      vi.advanceTimersByTime(DELAY_MS + 3000);
    });
    let undone = false;
    act(() => {
      undone = result.current.undoLatest();
    });
    await settle();

    expect(undone).toBe(true);
    expect(args.revert).toHaveBeenCalledTimes(1);
  });

  it("closes the window after it ran out", async () => {
    const { result } = renderQueue();
    const args = reversibleArgs();

    act(() => result.current.queueMutation(args));
    await settle();
    act(() => {
      vi.advanceTimersByTime(DELAY_MS + 3600);
    });
    let undone = true;
    act(() => {
      undone = result.current.undoLatest();
    });

    expect(undone).toBe(false);
    expect(args.revert).not.toHaveBeenCalled();
  });

  it("does not register a page-exit flush: there is nothing waiting", () => {
    const { result } = renderQueue();
    const args = reversibleArgs();

    act(() => result.current.queueMutation(args));
    firePageExit("pagehide");

    expect(args.execute).toHaveBeenCalledTimes(1);
  });
});
