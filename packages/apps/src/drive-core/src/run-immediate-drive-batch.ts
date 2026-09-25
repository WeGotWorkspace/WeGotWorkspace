import type { ReactNode } from "react";
import { runQueuedBatchAction } from "@/hooks/use-batch-actions";
import type { DeferredApiWriteArgs } from "@/hooks/use-queued-mutation";
import type { DriveAPIOperations } from "@/drive-core/src/drive-types";

type QueueMutation = (args: DeferredApiWriteArgs) => void;

export type ImmediateDriveBatchArgs = {
  key: string;
  toastMessage: string;
  icon: ReactNode;
  undoToastMessage: string;
  rollback: () => void;
  execute: (signal: AbortSignal) => Promise<void>;
  revert?: () => Promise<void>;
  operations?: DriveAPIOperations;
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
  operations,
  queueMutation,
}: ImmediateDriveBatchArgs): void {
  let completed = false;
  const undo = () => {
    rollback();
    if (completed && operations && revert) {
      void revert().catch(() => undefined);
    }
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
