import type { ReactNode } from "react";
import { runQueuedBatchAction } from "@/hooks/use-batch-actions";
import type { DeferredApiWriteArgs } from "@/hooks/use-queued-mutation";

type QueueMutation = (args: DeferredApiWriteArgs) => void;

export type ImmediateDriveBatchArgs = {
  key: string;
  toastMessage: string;
  icon: ReactNode;
  undoToastMessage: string;
  rollback: () => void;
  /**
   * Rename files one at a time. Call `markCompleted` after each rename that reached the server
   * so undo can revert those files when a later rename throws.
   */
  execute: (signal: AbortSignal, markCompleted: (key: string) => void) => Promise<void>;
  /**
   * Undo server renames for `completedKeys` only. Runs after `execute` resolves, or when it
   * throws after at least one `markCompleted` call.
   */
  revert?: (completedKeys: ReadonlySet<string>) => Promise<void>;
  queueMutation: QueueMutation;
};

/** Queues a drive batch that runs immediately and reverts files the server already renamed. */
export function runImmediateDriveBatch({
  key,
  toastMessage,
  icon,
  undoToastMessage,
  rollback,
  execute,
  revert,
  queueMutation,
}: ImmediateDriveBatchArgs): void {
  const completedKeys = new Set<string>();
  let undone = false;
  const undo = () => {
    // onError already reverts completed files. The Undo button stays up for the
    // undo window and would call this again.
    if (undone) return;
    undone = true;
    rollback();
    if (!revert || completedKeys.size === 0) return;
    // Copy the set. Undo aborts execute, but a rename that already reached the
    // server can still resolve and call markCompleted after this snapshot.
    // That file is not reverted, and a later undo will not run either (#965).
    void revert(new Set(completedKeys)).catch((error: unknown) => {
      console.error("Drive batch revert failed", error);
    });
  };

  runQueuedBatchAction({
    queueMutation,
    key,
    toastMessage,
    icon,
    undoToastMessage,
    execute: async (signal) => {
      await execute(signal, (itemKey) => {
        completedKeys.add(itemKey);
      });
    },
    rollback: undo,
    executeImmediately: true,
  });
}
