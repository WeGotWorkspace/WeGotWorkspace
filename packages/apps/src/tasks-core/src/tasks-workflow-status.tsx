import "@/tasks-core/src/tasks-workflow-status.css";
import { CheckCircle2, CircleDot, CircleX, Clock, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { TasksUILabels } from "@/tasks-core/src/tasks-labels";
import type { TaskWorkflowStatus } from "@/tasks-core/src/tasks-task-utils";

export function workflowStatusLabel(status: TaskWorkflowStatus, L: TasksUILabels): string {
  switch (status) {
    case "needs-action":
      return L.stateNeedsAction;
    case "in-process":
      return L.stateInProcess;
    case "completed":
      return L.stateCompleted;
    case "cancelled":
      return L.stateCancelled;
  }
}

const STATUS_ICONS: Record<TaskWorkflowStatus, LucideIcon> = {
  "needs-action": Clock,
  "in-process": CircleDot,
  completed: CheckCircle2,
  cancelled: CircleX,
};

/** The status icon on its own colour wash (see `tasks-workflow-status.css`). */
export function workflowStatusIcon(status: TaskWorkflowStatus): ReactNode {
  const Icon = STATUS_ICONS[status];
  return (
    <span className={`tasks-status-mark tasks-status-mark--${status}`} aria-hidden>
      <Icon className="size-3" />
    </span>
  );
}
