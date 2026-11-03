import type { Task, TaskPatch } from "@/tasks-core/src/tasks-types";
import type { TasksUILabels } from "@/tasks-core/src/tasks-labels";
import { applyTaskPatch } from "@/lib/offline/tasks/tasks-patch-merge";

export type TaskConflictFieldKey =
  "title" | "description" | "due" | "workflowStatus" | "priority" | "categories";

export type TaskConflictFieldChoice = "local" | "server";

export type TaskConflictFieldChoices = Record<TaskConflictFieldKey, TaskConflictFieldChoice>;

export type TaskConflictFieldRow = {
  key: TaskConflictFieldKey;
  label: string;
  localValue: string;
  serverValue: string;
};

const EMPTY_PLACEHOLDER = "—";

function formatText(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : EMPTY_PLACEHOLDER;
}

function formatCategories(categories: string[] | undefined): string {
  if (!categories || categories.length === 0) return EMPTY_PLACEHOLDER;
  return categories.join(", ");
}

function formatPriority(priority: number | null | undefined, L: TasksUILabels): string {
  if (priority === 1) return L.priorityHigh;
  if (priority === 5) return L.priorityMedium;
  if (priority === 9) return L.priorityLow;
  return L.priorityNone;
}

function formatStatus(status: string | null | undefined, L: TasksUILabels): string {
  if (status === "completed") return L.statusCompleted;
  if (status === "in-process") return L.statusInProcess;
  if (status === "cancelled") return L.statusCancelled;
  return L.statusNeedsAction;
}

function fieldDiffers(localValue: string, serverValue: string): boolean {
  return localValue !== serverValue;
}

export function buildTaskConflictFieldRows(
  serverTask: Task,
  localTask: Task,
  L: TasksUILabels,
): TaskConflictFieldRow[] {
  const rows: TaskConflictFieldRow[] = [
    {
      key: "title",
      label: L.editTaskTitle,
      localValue: formatText(localTask.title),
      serverValue: formatText(serverTask.title),
    },
    {
      key: "description",
      label: L.descriptionLabel,
      localValue: formatText(localTask.description),
      serverValue: formatText(serverTask.description),
    },
    {
      key: "due",
      label: L.dueLabel,
      localValue: formatText(localTask.due),
      serverValue: formatText(serverTask.due),
    },
    {
      key: "workflowStatus",
      label: L.addTaskStatus,
      localValue: formatStatus(localTask.workflowStatus, L),
      serverValue: formatStatus(serverTask.workflowStatus, L),
    },
    {
      key: "priority",
      label: L.addTaskPriority,
      localValue: formatPriority(localTask.priority, L),
      serverValue: formatPriority(serverTask.priority, L),
    },
    {
      key: "categories",
      label: "Tags",
      localValue: formatCategories(localTask.categories),
      serverValue: formatCategories(serverTask.categories),
    },
  ];

  return rows.filter((row) => fieldDiffers(row.localValue, row.serverValue));
}

export function defaultTaskConflictFieldChoices(
  rows: TaskConflictFieldRow[],
): TaskConflictFieldChoices {
  const choices = {} as TaskConflictFieldChoices;
  for (const row of rows) {
    choices[row.key] = "local";
  }
  return choices;
}

export function buildResolvedTaskPatch(
  serverTask: Task,
  localTask: Task,
  choices: TaskConflictFieldChoices,
): TaskPatch {
  const patch: TaskPatch = {};
  if (choices.title === "local" && localTask.title !== serverTask.title) {
    patch.title = localTask.title ?? "";
  }
  if (choices.description === "local" && localTask.description !== serverTask.description) {
    patch.description = localTask.description ?? null;
  }
  if (choices.due === "local" && localTask.due !== serverTask.due) {
    patch.due = localTask.due ?? null;
  }
  if (
    choices.workflowStatus === "local" &&
    localTask.workflowStatus !== serverTask.workflowStatus
  ) {
    patch.workflowStatus = localTask.workflowStatus ?? null;
  }
  if (choices.priority === "local" && localTask.priority !== serverTask.priority) {
    patch.priority = localTask.priority ?? null;
  }
  if (
    choices.categories === "local" &&
    formatCategories(localTask.categories) !== formatCategories(serverTask.categories)
  ) {
    patch.categories = localTask.categories ?? [];
  }
  return patch;
}

export function applyTaskConflictChoices(
  serverTask: Task,
  localTask: Task,
  choices: TaskConflictFieldChoices,
): Task {
  const patch = buildResolvedTaskPatch(serverTask, localTask, choices);
  return applyTaskPatch(serverTask, patch);
}
