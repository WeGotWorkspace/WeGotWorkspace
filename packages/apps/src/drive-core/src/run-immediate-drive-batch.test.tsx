/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  runImmediateDriveBatch,
  type ImmediateDriveBatchArgs,
} from "@/drive-core/src/run-immediate-drive-batch";
import { useQueuedMutation } from "@/hooks/use-queued-mutation";

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({
    show: vi.fn(() => "toast-1"),
    dismiss: vi.fn(),
    showSuccess: vi.fn(),
    showError: vi.fn(),
  }),
}));

type BatchOverrides = Partial<Omit<ImmediateDriveBatchArgs, "queueMutation">>;

function renderBatch(overrides: BatchOverrides) {
  const onMutationError = vi.fn();
  const rollback = vi.fn();
  const reverted: Array<ReadonlySet<string>> = [];
  const { result } = renderHook(() => useQueuedMutation({ onMutationError }));
  act(() => {
    runImmediateDriveBatch({
      key: "drive:trash:notes",
      toastMessage: "Moved 1 to Trash",
      icon: null,
      undoToastMessage: "Move to trash undone.",
      rollback,
      execute: async () => undefined,
      revert: async (completedKeys) => {
        reverted.push(completedKeys);
      },
      queueMutation: result.current.queueMutation,
      ...overrides,
    });
  });
  const undo = () =>
    act(() => {
      result.current.undoLatest();
    });
  return { onMutationError, rollback, reverted, undo };
}

/** A promise the test resolves by hand. */
function gate() {
  let open: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

describe("runImmediateDriveBatch through useQueuedMutation", () => {
  it("runs at once and reverts what landed when undo follows a finished batch", async () => {
    const execute = vi.fn(async (_stop: AbortSignal, markCompleted: (key: string) => void) => {
      markCompleted("notes");
    });
    const { reverted, rollback, undo } = renderBatch({ execute });

    expect(execute).toHaveBeenCalledTimes(1);
    await act(async () => undefined);
    undo();

    expect(rollback).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(reverted).toEqual([new Set(["notes"])]);
    });
  });

  it("waits for a rename still on its way, then reverts it", async () => {
    const rename = gate();
    const { reverted, rollback, undo } = renderBatch({
      execute: async (_stop, markCompleted) => {
        await rename.promise;
        markCompleted("notes");
      },
    });

    undo();
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(reverted).toEqual([]);

    rename.open();
    await vi.waitFor(() => {
      expect(reverted).toEqual([new Set(["notes"])]);
    });
  });

  it("stops starting new renames on undo, without cancelling the one on its way", async () => {
    const rename = gate();
    const renamed: string[] = [];
    let stopSeenByRename: AbortSignal | undefined;
    const { reverted, undo } = renderBatch({
      execute: async (stop, markCompleted) => {
        for (const id of ["notes", "other"]) {
          stop.throwIfAborted();
          stopSeenByRename = stop;
          if (id === "notes") await rename.promise;
          renamed.push(id);
          markCompleted(id);
        }
      },
    });

    undo();
    expect(stopSeenByRename?.aborted).toBe(true);
    rename.open();

    await vi.waitFor(() => {
      expect(reverted).toEqual([new Set(["notes"])]);
    });
    expect(renamed).toEqual(["notes"]);
  });

  it("sends no revert when nothing landed", async () => {
    const { reverted, onMutationError, undo } = renderBatch({
      execute: async () => {
        throw new Error("rename failed");
      },
    });

    await vi.waitFor(() => {
      expect(onMutationError).toHaveBeenCalledTimes(1);
    });
    undo();
    await act(async () => undefined);

    expect(reverted).toEqual([]);
  });

  it("reverts once when the error handler runs and the user undoes again", async () => {
    const { reverted, rollback, undo } = renderBatch({
      execute: async (_stop, markCompleted) => {
        markCompleted("notes");
        throw new Error("rename failed");
      },
    });

    await vi.waitFor(() => {
      expect(reverted).toHaveLength(1);
    });
    expect(rollback).toHaveBeenCalledTimes(1);

    undo();
    await act(async () => undefined);

    expect(reverted).toHaveLength(1);
    expect(rollback).toHaveBeenCalledTimes(1);
  });
});
