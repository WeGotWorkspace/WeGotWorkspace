/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { runImmediateDriveBatch } from "@/drive-core/src/run-immediate-drive-batch";
import { useQueuedMutation } from "@/hooks/use-queued-mutation";

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({
    show: vi.fn(() => "toast-1"),
    dismiss: vi.fn(),
    showSuccess: vi.fn(),
    showError: vi.fn(),
  }),
}));

describe("runImmediateDriveBatch through useQueuedMutation", () => {
  it("reverts a rename already marked when undo aborts the in-flight batch", async () => {
    const onMutationError = vi.fn();
    const { result } = renderHook(() => useQueuedMutation({ onMutationError }));
    const reverted: Array<ReadonlySet<string>> = [];

    act(() => {
      runImmediateDriveBatch({
        key: "drive:trash:notes",
        toastMessage: "Moved 1 to Trash",
        icon: null,
        undoToastMessage: "Move to trash undone.",
        rollback: () => undefined,
        execute: async (signal, markCompleted) => {
          markCompleted("early");
          await new Promise<void>((_resolve, reject) => {
            const abort = () => {
              reject(new DOMException("AbortError", "AbortError"));
            };
            if (signal.aborted) {
              abort();
              return;
            }
            signal.addEventListener("abort", abort, { once: true });
          });
        },
        revert: async (completedKeys) => {
          reverted.push(completedKeys);
        },
        queueMutation: result.current.queueMutation,
      });
    });

    act(() => {
      result.current.undoLatest();
    });

    await vi.waitFor(() => {
      expect(reverted).toEqual([new Set(["early"])]);
    });
    expect(onMutationError).not.toHaveBeenCalled();
  });

  it("reverts once when the error handler runs and the user undoes again", async () => {
    const { result } = renderHook(() => useQueuedMutation({ onMutationError: () => undefined }));
    let rolledBack = 0;
    let reverted = 0;

    act(() => {
      runImmediateDriveBatch({
        key: "drive:trash:notes",
        toastMessage: "Moved 1 to Trash",
        icon: null,
        undoToastMessage: "Move to trash undone.",
        rollback: () => {
          rolledBack += 1;
        },
        execute: async (_signal, markCompleted) => {
          markCompleted("notes");
          throw new Error("rename failed");
        },
        revert: async () => {
          reverted += 1;
        },
        queueMutation: result.current.queueMutation,
      });
    });

    await vi.waitFor(() => {
      expect(reverted).toBe(1);
    });
    expect(rolledBack).toBe(1);

    act(() => {
      result.current.undoLatest();
    });

    expect(reverted).toBe(1);
    expect(rolledBack).toBe(1);
  });
});
