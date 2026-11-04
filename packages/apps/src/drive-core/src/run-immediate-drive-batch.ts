import type { ReactNode } from "react";
import { runQueuedBatchAction } from "@/hooks/use-batch-actions";
import type { QueueMutation } from "@/hooks/use-queued-mutation";

export type ImmediateDriveBatchArgs = {
  key: string;
  toastMessage: string;
  icon: ReactNode;
  undoToastMessage: string;
  rollback: () => void;
  /**
   * Rename files one at a time, and call `markCompleted` for every rename the server applied,
   * so undo can revert those files when a later rename throws. `stop` is aborted on Undo: check
   * it between files so no new rename starts. Never pass it to a rename itself: a cancelled
   * request may still land, and then nothing would rename the file back.
   */
  execute: (stop: AbortSignal, markCompleted: (key: string) => void) => Promise<void>;
  /** Undo server renames for `completedKeys` only. Runs once `execute` has settled. */
  revert: (completedKeys: ReadonlySet<string>) => Promise<void>;
  queueMutation: QueueMutation;
};

/**
 * Queues a reversible drive batch: it runs at once, and Undo (or a failure halfway)
 * renames back the files the server already moved. See `ReversibleWriteArgs`.
 */
export function runImmediateDriveBatch({
  rollback,
  execute,
  revert,
  ...toast
}: ImmediateDriveBatchArgs): void {
  const stop = new AbortController();
  runQueuedBatchAction({
    ...toast,
    rollback: () => {
      stop.abort();
      rollback();
    },
    execute: (_signal, markCompleted) => execute(stop.signal, markCompleted),
    // Every rename the server applied is marked, so "no keys" means nothing landed.
    revert: async (completed) => {
      if (completed && completed.size > 0) await revert(completed);
    },
  });
}
