import type { ReactNode } from "react";
import { Select, SelectContent, SelectItem } from "@/ui/select";
import { CollectionGhostSelectTrigger } from "@/ui/collection-ghost-select";
import type { Task } from "@/lib/models/tasks-types";
import type { TasksUILabels } from "@/tasks-core/src/tasks-labels";
import {
  TASK_WORKFLOW_STATUSES,
  type TaskDueFields,
  type TaskWorkflowStatus,
} from "@/tasks-core/src/tasks-task-utils";
import { taskDueIsDateOnly } from "@/lib/models/task-fields";
import { workflowStatusIcon, workflowStatusLabel } from "@/tasks-core/src/tasks-workflow-status";
import {
  COMPOSER_PRIORITY_VALUES,
  normalizeTaskPriority,
  priorityIcon,
  priorityLabel,
  TASK_PRIORITY_NONE,
  type TaskPriorityValue,
} from "@/tasks-core/src/tasks-priority";
import {
  TasksComposerDuePicker,
  TasksDueAllDaySwitch,
} from "@/tasks-core/src/tasks-composer-due-picker";
import { taskAlarmControls } from "@/tasks-core/src/tasks-remind-picker";
import {
  TASK_FIELD_SELECT_CONTENT_CLASS,
  TASK_FIELD_SELECT_ITEM_CLASS,
} from "@/tasks-core/src/tasks-field-classes";
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

export type TaskFieldControls = {
  status: ReactNode;
  due: ReactNode;
  /** The All day switch; null while the task has no due date. */
  allDay: ReactNode | null;
  priority: ReactNode;
  /** One per alarm, then an empty one to add the next. */
  alarms: ReactNode[];
};

type TaskFieldControlsProps = {
  L: TasksUILabels;
  value: TasksTaskFormValue;
  onChange: (update: (previous: TasksTaskFormValue) => TasksTaskFormValue) => void;
  disabled?: boolean;
};

/**
 * One control per task field, for the rows of the task detail pane: the suite ghost
 * dropdown (as the list switcher above the title), value and chevron, no chrome.
 */
export function taskFieldControls({
  L,
  value,
  onChange,
  disabled = false,
}: TaskFieldControlsProps): TaskFieldControls {
  const setField = <K extends keyof TasksTaskFormValue>(key: K, next: TasksTaskFormValue[K]) => {
    onChange((previous) => ({ ...previous, [key]: next }));
  };
  const dueProps = {
    labels: L,
    due: value.due,
    showWithoutTime: value.showWithoutTime,
    onChange: (next: TaskDueFields) =>
      onChange((previous) => ({
        ...previous,
        due: next.due,
        showWithoutTime: next.showWithoutTime,
        timeZone: next.timeZone,
      })),
    disabled,
    done: value.workflowStatus === "completed" || value.workflowStatus === "cancelled",
  };
  return {
    due: <TasksComposerDuePicker {...dueProps} />,
    allDay: value.due ? <TasksDueAllDaySwitch {...dueProps} /> : null,
    status: (
      <Select
        value={value.workflowStatus}
        onValueChange={(workflowStatus) =>
          setField("workflowStatus", workflowStatus as TaskWorkflowStatus)
        }
        disabled={disabled}
      >
        <CollectionGhostSelectTrigger
          className="tasks-field__ghost"
          aria-label={L.addTaskStatus}
          disabled={disabled}
          leading={workflowStatusIcon(value.workflowStatus)}
          label={workflowStatusLabel(value.workflowStatus, L)}
        />
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
        <CollectionGhostSelectTrigger
          className="tasks-field__ghost"
          aria-label={L.addTaskPriority}
          disabled={disabled}
          leading={priorityIcon(value.priority)}
          label={priorityLabel(value.priority, L)}
        />
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
    alarms: taskAlarmControls({
      labels: L,
      alerts: value.alerts,
      onChange: (alerts) => setField("alerts", alerts),
      disabled,
    }),
  };
}
