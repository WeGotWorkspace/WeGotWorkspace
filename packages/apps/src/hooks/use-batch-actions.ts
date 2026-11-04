import type {
  IrreversibleWriteArgs,
  QueueMutation,
  ReversibleWriteArgs,
} from "@/hooks/use-queued-mutation";

type BatchCommon = {
  queueMutation: QueueMutation;
  /** Puts the screen back, on Undo and on failure. */
  rollback: () => void;
  undoToastMessage: string;
};

type RunBatchActionArgs =
  | (BatchCommon & Omit<ReversibleWriteArgs, "undo" | "onError" | "undoToastMessage">)
  | (BatchCommon & Omit<IrreversibleWriteArgs, "undo" | "onError" | "undoToastMessage">);

/** Queues a batch write whose Undo and failure both roll the screen back with `rollback`. */
export function runQueuedBatchAction({ queueMutation, rollback, ...write }: RunBatchActionArgs) {
  queueMutation({ ...write, undo: rollback, onError: rollback });
}
