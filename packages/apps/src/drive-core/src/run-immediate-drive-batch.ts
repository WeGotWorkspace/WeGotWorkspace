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
   * Undo the server write. Runs after `execute` resolves, or when it throws after at least one
   * `markCompleted` call. `completedKeys` lists those marks; an empty set means the whole execute finished.
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
  let finished = false;
  const undo = () => {
    rollback();
    if (!revert) return;
    if (!finished && completedKeys.size === 0) return;
    void revert(completedKeys).catch((error: unknown) => {
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
      finished = true;
    },
    rollback: undo,
    executeImmediately: true,
  });
}
