import { describe, expect, it } from "vitest";
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

describe("runImmediateDriveBatch", () => {
  it("rolls back without reverting when execute has not finished", () => {
    const { queued, queueMutation } = captureQueue();
    let rolledBack = 0;
    let reverted = 0;

    runImmediateDriveBatch({
      key: "drive:trash:1",
      toastMessage: "Moved 1 to Trash",
      icon: null,
      undoToastMessage: "Move to trash undone.",
      rollback: () => {
        rolledBack += 1;
      },
      execute: async () => undefined,
      revert: async () => {
        reverted += 1;
      },
      operations: {} as never,
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
      key: "drive:trash:1",
      toastMessage: "Moved 1 to Trash",
      icon: null,
      undoToastMessage: "Move to trash undone.",
      rollback: () => undefined,
      execute: async () => undefined,
      revert: async () => {
        reverted += 1;
      },
      operations: {} as never,
      queueMutation,
    });

    await queued[0]?.execute?.(new AbortController().signal);
    queued[0]?.undo?.();

    expect(reverted).toBe(1);
  });
});
