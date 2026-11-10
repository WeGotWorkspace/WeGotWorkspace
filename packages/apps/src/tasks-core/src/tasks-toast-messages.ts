import type { TasksUILabels } from "@/tasks-core/src/tasks-labels";

export function tasksCompleteToastMessage(
  completing: boolean,
  count: number,
  labels: Pick<TasksUILabels, "toastTasksCompleted" | "toastTasksReopened">,
): string {
  return completing ? labels.toastTasksCompleted(count) : labels.toastTasksReopened(count);
}

export function tasksMoveToastMessage(
  count: number,
  listName: string,
  labels: Pick<TasksUILabels, "toastTaskMoved">,
): string {
  return labels.toastTaskMoved(count, listName);
}
