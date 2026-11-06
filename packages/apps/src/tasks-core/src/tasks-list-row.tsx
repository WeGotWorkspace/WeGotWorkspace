import { memo, useEffect } from "react";
import { CalendarDays, Check, Trash2 } from "lucide-react";
import { ListItem } from "@/list-item/src/list-item";
import { NotesNotebookColorDot } from "@/notes-core/src/notes-notebook-color-dot";
import { Checkbox } from "@/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";
import type { Task, TaskList } from "@/tasks-core/src/tasks-types";
import type { TasksUILabels } from "@/tasks-core/src/tasks-labels";
import {
  formatComposerDueLabel,
  isTaskCompleted,
  taskListDotColor,
  taskListName,
  taskListTitle,
  type TaskWorkflowStatus,
} from "@/tasks-core/src/tasks-task-utils";
import { workflowStatusIcon, workflowStatusLabel } from "@/tasks-core/src/tasks-workflow-status";
import { isTaskPriorityNone, priorityIcon, priorityLabel } from "@/tasks-core/src/tasks-priority";
import { TasksRemindIndicator } from "@/tasks-core/src/tasks-remind-picker";

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

const ROW_PROP_KEYS = [
  "task",
  "L",
  "taskList",
  "taskLists",
  "canMutate",
  "isTouch",
  "isExiting",
  "dragging",
  "onToggleComplete",
  "onDeleteTask",
  "onExitAnimationEnd",
] as const satisfies readonly (keyof TasksListRowProps)[];

/** Same memo rule as `NotesListRow`: compare only the row's own props (#1714). */
function sameTasksListRowProps(prev: TasksListRowProps, next: TasksListRowProps): boolean {
  return ROW_PROP_KEYS.every((key) => Object.is(prev[key], next[key]));
}

/** The row foot: list dot and name, due, priority, a status other than the default, reminders. */
function TasksListRowMeta({
  task,
  L,
  taskList,
  taskLists,
}: Pick<TasksListRowProps, "task" | "L" | "taskList" | "taskLists">) {
  const listName = taskListName(task.taskListId, taskLists);
  const workflowStatus = (task.workflowStatus ?? "needs-action") as TaskWorkflowStatus;
  const dueLabel = formatComposerDueLabel(task.due, task.showWithoutTime, {
    dueToday: L.dueToday,
    dueYesterday: L.dueYesterday,
    dueTomorrow: L.dueTomorrow,
  });
  const showStatus = workflowStatus === "in-process" || workflowStatus === "cancelled";
  return (
    <span className="tasks-list-row__meta">
      <span className="tasks-list-row__meta-item">
        <NotesNotebookColorDot color={taskListDotColor(taskList ?? task.taskListId)} />
        <span className="tasks-list-row__meta-text">{listName}</span>
      </span>
      {dueLabel ? (
        <span className="tasks-list-row__meta-item">
          <CalendarDays className="size-3.5" aria-hidden />
          <span className="tasks-list-row__meta-text">{dueLabel}</span>
        </span>
      ) : null}
      {!isTaskPriorityNone(task.priority) ? (
        <span className="tasks-list-row__meta-item">
          {priorityIcon(task.priority)}
          <span className="tasks-list-row__meta-text">{priorityLabel(task.priority, L)}</span>
        </span>
      ) : null}
      {showStatus ? (
        <span className="tasks-list-row__meta-item">
          {workflowStatusIcon(workflowStatus)}
          <span className="tasks-list-row__meta-text">
            {workflowStatusLabel(workflowStatus, L)}
          </span>
        </span>
      ) : null}
      <TasksRemindIndicator labels={L} alerts={task.alerts} />
    </span>
  );
}

/**
 * One task in the list: the Notes row (`ListItem`, `below` layout) with the complete
 * checkbox in front. Re-renders only when its own task or flags change.
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
  const completeControl = canMutate ? (
    checkbox
  ) : (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="tasks-list-row__complete-hint">{checkbox}</span>
      </TooltipTrigger>
      <TooltipContent>{L.viewOnlyListBadge}</TooltipContent>
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
}, sameTasksListRowProps);
