import {
  SyncConflictDialog,
  type SyncConflictDialogProps,
} from "@/dialogs/src/sync-conflict-dialog";
import type { TasksUILabels } from "@/tasks-core/src/tasks-labels";
import type { TaskConflictFieldKey } from "@/lib/offline/tasks/tasks-conflict-merge";

export type TasksConflictDialogProps = Omit<
  SyncConflictDialogProps<TaskConflictFieldKey>,
  "itemName" | "labels" | "surfaceClassName"
> & {
  taskTitle: string;
  labels: TasksUILabels;
};

/** Field-level or binary resolver for a single task sync conflict. */
export function TasksConflictDialog({ taskTitle, ...props }: TasksConflictDialogProps) {
  return (
    <SyncConflictDialog {...props} itemName={taskTitle} surfaceClassName="tasks-dialog-surface" />
  );
}
