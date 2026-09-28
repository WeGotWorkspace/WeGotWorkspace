import { describe, expect, it, vi } from "vitest";
import type { DeferredApiWriteArgs } from "@/hooks/use-queued-mutation";
import { runImmediateDriveBatch } from "@/drive-core/src/run-immediate-drive-batch";

function captureQueue() {
  const queued: DeferredApiWriteArgs[] = [];
  return {
    queued,
    queueMutation: (args: DeferredApiWriteArgs) => {
      queued.push(args);
    },
  };
}

const batch = {
  key: "drive:trash:1",
  toastMessage: "Moved 1 to Trash",
  icon: null,
  undoToastMessage: "Move to trash undone.",
};

describe("runImmediateDriveBatch", () => {
  it("rolls back without reverting when execute has not finished", () => {
    const { queued, queueMutation } = captureQueue();
    let rolledBack = 0;
    let reverted = 0;

    runImmediateDriveBatch({
      ...batch,
      rollback: () => {
        rolledBack += 1;
      },
      execute: async () => undefined,
      revert: async () => {
        reverted += 1;
      },
      queueMutation,
    });

    queued[0]?.undo?.();

    expect(rolledBack).toBe(1);
    expect(reverted).toBe(0);
  });

  it("reverts after execute has finished", async () => {
    const { queued, queueMutation } = captureQueue();
    let reverted = 0;

    runImmediateDriveBatch({
      ...batch,
      rollback: () => undefined,
      execute: async () => undefined,
      revert: async () => {
        reverted += 1;
      },
      queueMutation,
    });

    await queued[0]?.execute?.(new AbortController().signal);
    queued[0]?.undo?.();

    expect(reverted).toBe(1);
  });

  it("rolls back without reverting when execute throws", async () => {
    const { queued, queueMutation } = captureQueue();
    let rolledBack = 0;
    let reverted = 0;

    runImmediateDriveBatch({
      ...batch,
      rollback: () => {
        rolledBack += 1;
      },
      execute: async () => {
        throw new Error("rename failed");
      },
      revert: async () => {
        reverted += 1;
      },
      queueMutation,
    });

    await expect(queued[0]?.execute?.(new AbortController().signal)).rejects.toThrow(
      "rename failed",
    );
    queued[0]?.undo?.();

    expect(rolledBack).toBe(1);
    expect(reverted).toBe(0);
  });

  it("reverts completed files when execute throws after a rename", async () => {
    const { queued, queueMutation } = captureQueue();
    let reverted: ReadonlySet<string> | undefined;

    runImmediateDriveBatch({
      ...batch,
      rollback: () => undefined,
      execute: async (_signal, markCompleted) => {
        markCompleted("notes");
        throw new Error("rename failed");
      },
      revert: async (completedKeys) => {
        reverted = completedKeys;
      },
      queueMutation,
    });

    await expect(queued[0]?.execute?.(new AbortController().signal)).rejects.toThrow(
      "rename failed",
    );
    queued[0]?.undo?.();

    expect(reverted).toEqual(new Set(["notes"]));
  });

  it("rolls back without reverting when no revert is passed", async () => {
    const { queued, queueMutation } = captureQueue();
    let rolledBack = 0;

    runImmediateDriveBatch({
      ...batch,
      rollback: () => {
        rolledBack += 1;
      },
      execute: async () => undefined,
      queueMutation,
    });

    await queued[0]?.execute?.(new AbortController().signal);
    queued[0]?.undo?.();

    expect(rolledBack).toBe(1);
  });

  it("logs a failed server revert after local rollback", async () => {
    const { queued, queueMutation } = captureQueue();
    const error = new Error("revert failed");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let rolledBack = 0;

    runImmediateDriveBatch({
      ...batch,
      rollback: () => {
        rolledBack += 1;
      },
      execute: async () => undefined,
      revert: async () => {
        throw error;
      },
      queueMutation,
    });

    await queued[0]?.execute?.(new AbortController().signal);
    queued[0]?.undo?.();

    expect(rolledBack).toBe(1);
    await vi.waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith("Drive batch revert failed", error);
    });
    consoleError.mockRestore();
  });
});
