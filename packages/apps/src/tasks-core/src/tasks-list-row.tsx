import { memo, useEffect } from "react";
import { Check, Trash2 } from "lucide-react";
import { ListItem } from "@/list-item/src/list-item";
import { workspaceListRowPropsEqual } from "@/workspace-list/src/workspace-list-row-props";
import { CollectionColorDot } from "@/ui/collection-color-dot";
import { Checkbox } from "@/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";
import type { Task, TaskList } from "@/lib/models/tasks-types";
import type { TasksUILabels } from "@/tasks-core/src/tasks-labels";
import {
  formatTaskDueRelative,
  isTaskCompleted,
  taskDueSeverity,
  taskListDotColor,
  taskListName,
  taskListTitle,
  type TaskWorkflowStatus,
} from "@/tasks-core/src/tasks-task-utils";
import { workflowStatusIcon, workflowStatusLabel } from "@/tasks-core/src/tasks-workflow-status";
import { PriorityMark } from "@/tasks-core/src/tasks-priority";
import { TasksRemindIndicator } from "@/tasks-core/src/tasks-remind-picker";
import { taskAlertCount } from "@/tasks-core/src/tasks-alert-mapping";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export type TasksListRowProps = {
  task: Task;
  L: TasksUILabels;
  /** The task's own list (colour dot and name), when known. */
  taskList: TaskList | undefined;
  /** All lists, for the name fallback of a list that is not loaded. */
  taskLists: TaskList[];
  canMutate: boolean;
  isTouch: boolean;
  isExiting: boolean;
  dragging: boolean;
  /** Must keep its identity across renders, or every row re-renders. */
  onToggleComplete: (taskId: string) => void;
  /** Must keep its identity across renders, or every row re-renders. */
  onDeleteTask: (taskId: string) => void;
  /** Must keep its identity across renders, or every row re-renders. */
  onExitAnimationEnd: (taskId: string) => void;
};

/** The row foot: list dot and name, the due day relative to today, and a status other than the default. */
function TasksListRowMeta({
  task,
  L,
  taskList,
  taskLists,
}: Pick<TasksListRowProps, "task" | "L" | "taskList" | "taskLists">) {
  const listName = taskListName(task.taskListId, taskLists);
  const workflowStatus = (task.workflowStatus ?? "needs-action") as TaskWorkflowStatus;
  const showStatus = workflowStatus === "in-process" || workflowStatus === "cancelled";
  const dueRelative = formatTaskDueRelative(task.due, L);
  const dueSeverity = taskDueSeverity(task.due, isTaskCompleted(task));
  return (
    <span className="tasks-list-row__meta">
      <span className="tasks-list-row__meta-item list-item__meta-segment">
        <CollectionColorDot color={taskListDotColor(taskList ?? task.taskListId)} />
        <span className="tasks-list-row__meta-text">{listName}</span>
      </span>
      {dueRelative ? (
        <span
          className="tasks-list-row__meta-item list-item__meta-segment tasks-list-row__due"
          data-severity={dueSeverity ?? undefined}
        >
          <span className="tasks-list-row__meta-text">{dueRelative}</span>
        </span>
      ) : null}
      {showStatus ? (
        <span className="tasks-list-row__meta-item list-item__meta-segment">
          {workflowStatusIcon(workflowStatus)}
          <span className="tasks-list-row__meta-text">
            {workflowStatusLabel(workflowStatus, L)}
          </span>
        </span>
      ) : null}
    </span>
  );
}

/** Top right: the reminder bell (when set), then the priority flag (always; grey for none). */
function TasksListRowMarks({ task, L }: Pick<TasksListRowProps, "task" | "L">) {
  return (
    <span className="tasks-list-row__marks">
      {taskAlertCount(task.alerts) > 0 ? (
        <TasksRemindIndicator labels={L} alerts={task.alerts} />
      ) : null}
      <PriorityMark priority={task.priority} L={L} />
    </span>
  );
}

/**
 * One task in the list: the Notes row (`ListItem`, `below` layout) with the complete
 * checkbox in front. Memoized with the shared list comparison (#1641 step d): it
 * re-renders only when its own task or flags change.
 */
export const TasksListRow = memo(function TasksListRow({
  task,
  L,
  taskList,
  taskLists,
  canMutate,
  isTouch,
  isExiting,
  dragging,
  onToggleComplete,
  onDeleteTask,
  onExitAnimationEnd,
}: TasksListRowProps) {
  const completed = isTaskCompleted(task);

  useEffect(() => {
    if (!isExiting || !prefersReducedMotion()) return;
    onExitAnimationEnd(task.id);
  }, [isExiting, onExitAnimationEnd, task.id]);

  const completeDisabled = isExiting || !canMutate;
  const checkbox = (
    <Checkbox
      size="md"
      mark
      className="tasks-list-row__complete"
      checked={completed}
      aria-label={completed ? L.markIncomplete : L.markComplete}
      draggable={false}
      disabled={completeDisabled}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onCheckedChange={() => onToggleComplete(task.id)}
    />
  );
  // The tooltip names what a click does; a read-only list says why it cannot. The
  // trigger is a span around the box: on the box itself the tooltip's `data-state`
  // would replace the checked state the box is styled by (and a disabled box takes
  // no hover).
  const completeControl = (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="tasks-list-row__complete-hint">{checkbox}</span>
      </TooltipTrigger>
      <TooltipContent>
        {canMutate ? (completed ? L.markIncomplete : L.markComplete) : L.viewOnlyListBadge}
      </TooltipContent>
    </Tooltip>
  );

  return (
    <div
      className="tasks-list-row"
      data-completed={completed ? "true" : "false"}
      data-exiting={isExiting ? "true" : "false"}
      onAnimationEnd={(event) => {
        if (!isExiting || event.animationName !== "tasks-row-exit") return;
        onExitAnimationEnd(task.id);
      }}
    >
      <ListItem
        id={task.id}
        title={taskListTitle(task, "")}
        emptyTitle={L.untitledTask}
        metaPosition="below"
        date=""
        dateLeading={<TasksListRowMarks task={task} L={L} />}
        text={task.description?.trim() || null}
        subtitle={<TasksListRowMeta task={task} L={L} taskList={taskList} taskLists={taskLists} />}
        leadingControl={completeControl}
        isActive={false}
        isSelected={false}
        selectionMode={false}
        isTouch={isTouch}
        isDragging={dragging}
        {...(isTouch && canMutate && !isExiting
          ? {
              swipeLeftAction: {
                icon: <Check className="size-5" />,
                label: completed ? L.markIncomplete : L.markComplete,
                onActivate: () => onToggleComplete(task.id),
              },
              swipeRightAction: {
                icon: <Trash2 className="size-5" />,
                tone: "danger" as const,
                label: L.delete,
                onActivate: () => onDeleteTask(task.id),
              },
            }
          : {})}
      />
    </div>
  );
}, workspaceListRowPropsEqual);
