import type { Task, TaskCreate, TaskPatch } from "@/tasks-core/src/tasks-types";

export function taskEtag(task: Task): string | undefined {
  return (task as Task & { etag?: string }).etag;
}

export function applyTaskPatch(task: Task, patch: TaskPatch): Task {
  const { alerts, ...rest } = patch;
  const next: Task = { ...task, ...rest };
  if (alerts === null) {
    delete next.alerts;
  } else if (alerts !== undefined) {
    next.alerts = alerts;
  }
  return next;
}

export function coalesceTaskPatches(a: TaskPatch, b: TaskPatch): TaskPatch {
  return { ...a, ...b };
}

/** Build a PUT body for moving or replacing a task in a target list. */
export function taskCreateFromTask(task: Task, taskListId: string): TaskCreate {
  return {
    title: task.title ?? "",
    taskListIds: { [taskListId]: true },
    uid: task.uid,
    description: task.description,
    start: task.start,
    due: task.due,
    completed: task.completed,
    showWithoutTime: task.showWithoutTime,
    timeZone: task.timeZone,
    workflowStatus: task.workflowStatus,
    progress: task.progress,
    priority: task.priority,
    categories: task.categories,
    privacy: task.privacy,
    recurrenceRules: task.recurrenceRules,
    excludedRecurrenceDates: task.excludedRecurrenceDates,
    recurrenceOverrides: task.recurrenceOverrides,
    alerts: task.alerts,
    participants: task.participants,
    icsProps: task.icsProps,
  };
}
