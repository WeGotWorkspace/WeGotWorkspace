import {
  cloneElement,
  isValidElement,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { TextareaAutosize } from "@/ui/textarea-autosize";
import type { Task, TaskList } from "@/tasks-core/src/tasks-types";
import type { TasksUILabels } from "@/tasks-core/src/tasks-labels";
import { TaskListDot } from "@/tasks-core/src/tasks-list-dot";
import { TASK_WORKFLOW_STATUSES, type TaskWorkflowStatus } from "@/tasks-core/src/tasks-task-utils";
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

export type TasksTaskFormValue = {
  title: string;
  description: string;
  listId: string;
  workflowStatus: TaskWorkflowStatus;
  priority: TaskPriorityValue;
  due: string | null;
  alerts?: Task["alerts"];
};

/** @deprecated Use TasksTaskFormValue */
export type TasksCreateInput = TasksTaskFormValue;

export const DEFAULT_WORKFLOW_STATUS: TaskWorkflowStatus = "needs-action";

export const CREATE_WORKFLOW_STATUSES: TaskWorkflowStatus[] = ["needs-action", "in-process"];

export const COMPOSER_SELECT_TRIGGER_CLASS = "tasks-main-view__composer-select";
export const COMPOSER_SELECT_CONTENT_CLASS = "tasks-main-view__composer-select-content";
export const COMPOSER_SELECT_ITEM_CLASS = "tasks-main-view__composer-select-item";

/** Shared composer + row chip order. Alerts/remind stays last. */
export const TASK_META_FIELD_ORDER = ["due", "list", "status", "priority", "remind"] as const;
export type TaskMetaField = (typeof TASK_META_FIELD_ORDER)[number];

export function orderedTaskMetaNodes(
  nodes: Partial<Record<TaskMetaField, ReactNode>>,
): ReactNode[] {
  return TASK_META_FIELD_ORDER.flatMap((field) => {
    const node = nodes[field];
    if (node == null) return [];
    if (isValidElement(node)) return [cloneElement(node, { key: field })];
    return [node];
  });
}

export function emptyTaskForm(listId: string): TasksTaskFormValue {
  return {
    title: "",
    description: "",
    listId,
    workflowStatus: DEFAULT_WORKFLOW_STATUS,
    priority: TASK_PRIORITY_NONE,
    due: null,
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
    alerts: task.alerts,
  };
}

export function ComposerSelectOption({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <span className="tasks-main-view__composer-select-option">
      {icon}
      {label}
    </span>
  );
}

type TasksTaskFormFieldsProps = {
  L: TasksUILabels;
  value: TasksTaskFormValue;
  onChange: (
    value: TasksTaskFormValue | ((previous: TasksTaskFormValue) => TasksTaskFormValue),
  ) => void;
  taskLists: TaskList[];
  mode: "create" | "edit";
  disabled?: boolean;
  showDescription?: boolean;
  titleRef?: RefObject<HTMLInputElement | null>;
  onTitleFocus?: () => void;
  onDescriptionKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
};

export function TasksTaskFormFields({
  L,
  value,
  onChange,
  taskLists,
  mode,
  disabled = false,
  showDescription = true,
  titleRef,
  onTitleFocus,
  onDescriptionKeyDown,
}: TasksTaskFormFieldsProps) {
  const workflowStatuses = mode === "create" ? CREATE_WORKFLOW_STATUSES : TASK_WORKFLOW_STATUSES;

  const setField = <K extends keyof TasksTaskFormValue>(key: K, next: TasksTaskFormValue[K]) => {
    onChange((previous) => ({ ...previous, [key]: next }));
  };

  return (
    <>
      <input
        ref={titleRef}
        type="text"
        className="tasks-main-view__composer-title"
        value={value.title}
        onChange={(event) => setField("title", event.target.value)}
        onFocus={onTitleFocus}
        placeholder={L.addTaskNamePlaceholder}
        aria-label={L.addTaskName}
        disabled={disabled}
      />

      {showDescription ? (
        <TextareaAutosize
          className="tasks-main-view__composer-description"
          value={value.description}
          onChange={(event) => setField("description", event.target.value)}
          onKeyDown={onDescriptionKeyDown}
          placeholder={L.addTaskDescriptionPlaceholder}
          aria-label={L.descriptionLabel}
          minRows={1}
          maxRows={8}
          disabled={disabled}
        />
      ) : null}

      <div className="tasks-main-view__composer-meta">
        {orderedTaskMetaNodes({
          due: (
            <TasksComposerDuePicker
              labels={L}
              value={value.due}
              onChange={(due) => setField("due", due)}
              disabled={disabled}
              triggerClassName={COMPOSER_SELECT_TRIGGER_CLASS}
            />
          ),
          list: (
            <Select
              value={value.listId}
              onValueChange={(listId) => setField("listId", listId)}
              disabled={disabled}
            >
              <SelectTrigger className={COMPOSER_SELECT_TRIGGER_CLASS} aria-label={L.addTaskList}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className={COMPOSER_SELECT_CONTENT_CLASS}>
                {taskLists.map((list) => (
                  <SelectItem key={list.id} value={list.id} className={COMPOSER_SELECT_ITEM_CLASS}>
                    <ComposerSelectOption icon={<TaskListDot list={list} />} label={list.name} />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ),
          status: (
            <Select
              value={value.workflowStatus}
              onValueChange={(workflowStatus) =>
                setField("workflowStatus", workflowStatus as TaskWorkflowStatus)
              }
              disabled={disabled}
            >
              <SelectTrigger className={COMPOSER_SELECT_TRIGGER_CLASS} aria-label={L.addTaskStatus}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className={COMPOSER_SELECT_CONTENT_CLASS}>
                {workflowStatuses.map((status) => (
                  <SelectItem key={status} value={status} className={COMPOSER_SELECT_ITEM_CLASS}>
                    <ComposerSelectOption
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
              onValueChange={(priority) =>
                setField("priority", Number(priority) as TaskPriorityValue)
              }
              disabled={disabled}
            >
              <SelectTrigger
                className={COMPOSER_SELECT_TRIGGER_CLASS}
                aria-label={L.addTaskPriority}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className={COMPOSER_SELECT_CONTENT_CLASS}>
                {COMPOSER_PRIORITY_VALUES.map((priority) => (
                  <SelectItem
                    key={priority}
                    value={String(priority)}
                    className={COMPOSER_SELECT_ITEM_CLASS}
                  >
                    <ComposerSelectOption
                      icon={priorityIcon(priority)}
                      label={priorityLabel(priority, L)}
                    />
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
        })}
      </div>
    </>
  );
}
