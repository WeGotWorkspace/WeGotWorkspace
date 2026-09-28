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
  execute: (signal: AbortSignal) => Promise<void>;
  revert?: () => Promise<void>;
  queueMutation: QueueMutation;
};

/** Queues a drive batch that runs immediately and only reverts after execute finishes. */
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
  let completed = false;
  const undo = () => {
    rollback();
    if (!completed || !revert) return;
    void revert().catch((error: unknown) => {
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
      await execute(signal);
      completed = true;
    },
    rollback: undo,
    executeImmediately: true,
  });
}
