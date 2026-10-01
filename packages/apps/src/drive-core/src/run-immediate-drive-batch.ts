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
   * throws after at least one `markCompleted` call. If undo aborts an in-flight execute, the
   * revert waits until that execute settles so a rename that resolves after abort is included.
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
  let executeSettled = false;
  let revertStarted = false;
  const revertCompleted = () => {
    if (revertStarted || !revert || completedKeys.size === 0) return;
    revertStarted = true;
    void revert(new Set(completedKeys)).catch((error: unknown) => {
      console.error("Drive batch revert failed", error);
    });
  };
  const undo = () => {
    // onError already reverts completed files. The Undo button stays up for the
    // undo window and would call this again.
    if (undone) return;
    undone = true;
    rollback();
    // A rename can still resolve after abort. Revert only once execute has
    // settled so that markCompleted is part of this undo (#965).
    if (executeSettled) revertCompleted();
  };

  runQueuedBatchAction({
    queueMutation,
    key,
    toastMessage,
    icon,
    undoToastMessage,
    execute: async (signal) => {
      try {
        await execute(signal, (itemKey) => {
          completedKeys.add(itemKey);
        });
      } finally {
        executeSettled = true;
        if (undone) revertCompleted();
      }
    },
    rollback: undo,
    executeImmediately: true,
  });
}
