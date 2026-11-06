import type { ReactNode } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import type { Task } from "@/tasks-core/src/tasks-types";
import type { TasksUILabels } from "@/tasks-core/src/tasks-labels";
import {
  TASK_WORKFLOW_STATUSES,
  taskDueIsDateOnly,
  type TaskWorkflowStatus,
} from "@/tasks-core/src/tasks-task-utils";
import { workflowStatusIcon, workflowStatusLabel } from "@/tasks-core/src/tasks-workflow-status";
import {
  COMPOSER_PRIORITY_VALUES,
  normalizeTaskPriority,
  priorityIcon,
  priorityLabel,
  TASK_PRIORITY_NONE,
  type TaskPriorityValue,
} from "@/tasks-core/src/tasks-priority";
import { TasksComposerDuePicker } from "@/tasks-core/src/tasks-composer-due-picker";
import { TasksRemindPicker } from "@/tasks-core/src/tasks-remind-picker";
import "@/tasks-core/src/tasks-field-controls.css";

export type TasksTaskFormValue = {
  title: string;
  description: string;
  listId: string;
  workflowStatus: TaskWorkflowStatus;
  priority: TaskPriorityValue;
  due: string | null;
  showWithoutTime?: boolean;
  timeZone?: string | null;
  alerts?: Task["alerts"];
};

export const DEFAULT_WORKFLOW_STATUS: TaskWorkflowStatus = "needs-action";

export const TASK_FIELD_SELECT_TRIGGER_CLASS = "tasks-field__select";
export const TASK_FIELD_SELECT_CONTENT_CLASS = "tasks-field__select-content";
export const TASK_FIELD_SELECT_ITEM_CLASS = "tasks-field__select-item";

export function emptyTaskForm(listId: string): TasksTaskFormValue {
  return {
    title: "",
    description: "",
    listId,
    workflowStatus: DEFAULT_WORKFLOW_STATUS,
    priority: TASK_PRIORITY_NONE,
    due: null,
    showWithoutTime: true,
    timeZone: null,
    alerts: undefined,
  };
}

export function taskToFormValue(task: Task, fallbackListId: string): TasksTaskFormValue {
  return {
    title: task.title ?? "",
    description: task.description ?? "",
    listId: task.taskListId ?? fallbackListId,
    workflowStatus: (task.workflowStatus ?? DEFAULT_WORKFLOW_STATUS) as TaskWorkflowStatus,
    priority: (normalizeTaskPriority(task.priority) ?? TASK_PRIORITY_NONE) as TaskPriorityValue,
    due: task.due ?? null,
    showWithoutTime: taskDueIsDateOnly(task.due, task.showWithoutTime),
    timeZone: task.timeZone ?? null,
    alerts: task.alerts,
  };
}

export function TaskFieldOption({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <span className="tasks-field__select-option">
      {icon}
      {label}
    </span>
  );
}

export type TaskFieldControl = "due" | "status" | "priority" | "remind";

type TaskFieldControlsProps = {
  L: TasksUILabels;
  value: TasksTaskFormValue;
  onChange: (update: (previous: TasksTaskFormValue) => TasksTaskFormValue) => void;
  disabled?: boolean;
};

/** One control per task field, for the rows of the task detail pane. */
export function taskFieldControls({
  L,
  value,
  onChange,
  disabled = false,
}: TaskFieldControlsProps): Record<TaskFieldControl, ReactNode> {
  const setField = <K extends keyof TasksTaskFormValue>(key: K, next: TasksTaskFormValue[K]) => {
    onChange((previous) => ({ ...previous, [key]: next }));
  };
  return {
    due: (
      <TasksComposerDuePicker
        labels={L}
        due={value.due}
        showWithoutTime={value.showWithoutTime}
        timeZone={value.timeZone}
        onChange={(next) =>
          onChange((previous) => ({
            ...previous,
            due: next.due,
            showWithoutTime: next.showWithoutTime,
            timeZone: next.timeZone,
          }))
        }
        disabled={disabled}
        triggerClassName={TASK_FIELD_SELECT_TRIGGER_CLASS}
      />
    ),
    status: (
      <Select
        value={value.workflowStatus}
        onValueChange={(workflowStatus) =>
          setField("workflowStatus", workflowStatus as TaskWorkflowStatus)
        }
        disabled={disabled}
      >
        <SelectTrigger
          size="md"
          className={TASK_FIELD_SELECT_TRIGGER_CLASS}
          aria-label={L.addTaskStatus}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent className={TASK_FIELD_SELECT_CONTENT_CLASS}>
          {TASK_WORKFLOW_STATUSES.map((status) => (
            <SelectItem key={status} value={status} className={TASK_FIELD_SELECT_ITEM_CLASS}>
              <TaskFieldOption
                icon={workflowStatusIcon(status)}
                label={workflowStatusLabel(status, L)}
              />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    ),
    priority: (
      <Select
        value={String(value.priority)}
        onValueChange={(priority) => setField("priority", Number(priority) as TaskPriorityValue)}
        disabled={disabled}
      >
        <SelectTrigger
          size="md"
          className={TASK_FIELD_SELECT_TRIGGER_CLASS}
          aria-label={L.addTaskPriority}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent className={TASK_FIELD_SELECT_CONTENT_CLASS}>
          {COMPOSER_PRIORITY_VALUES.map((priority) => (
            <SelectItem
              key={priority}
              value={String(priority)}
              className={TASK_FIELD_SELECT_ITEM_CLASS}
            >
              <TaskFieldOption icon={priorityIcon(priority)} label={priorityLabel(priority, L)} />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    ),
    remind: (
      <TasksRemindPicker
        labels={L}
        alerts={value.alerts}
        onChange={(alerts) => setField("alerts", alerts)}
        disabled={disabled}
      />
    ),
  };
}
