import { useEffect, useState } from "react";
import { subscribeSettingsSliceSaved } from "@/lib/settings-slice-saved";

/** Priority values as iCalendar has them: 0 none, 1 high, 5 medium, 9 low. */
export const NEW_TASK_PRIORITIES = [0, 1, 5, 9] as const;
export type NewTaskPriority = (typeof NEW_TASK_PRIORITIES)[number];

/** The first is the default; the others are the statuses a new task may start in. */
export const NEW_TASK_STATUSES = ["needs-action", "in-process"] as const;
export type NewTaskStatus = (typeof NEW_TASK_STATUSES)[number];

/** What a task is created with in Tasks: stored on this device, edited in Tasks settings. */
export type TasksNewTaskPrefs = {
  priority: NewTaskPriority;
  status: NewTaskStatus;
};

/** Settings copy. The option names match the ones Tasks shows on a task. */
export const tasksNewTaskLabels = {
  priority: "Default priority",
  priorityHint: "The priority a new task starts with",
  status: "Default status",
  statusHint: "The status a new task starts with",
  priorities: { 0: "None", 1: "High", 5: "Medium", 9: "Low" },
  statuses: { "needs-action": "Not started", "in-process": "In progress" },
  saveError: "Could not save Tasks settings",
} as const;

export const DEFAULT_TASKS_NEW_TASK_PREFS: TasksNewTaskPrefs = {
  priority: 0,
  status: "needs-action",
};

export const TASKS_NEW_TASK_PREFS_STORAGE_KEY = "wgw.ui.tasks.newTaskDefaults";
export const TASKS_NEW_TASK_PREFS_SLICE = { panelId: "tasks", sliceId: "tasks-new-task-defaults" };

export function parseTasksNewTaskPrefs(raw: string | null): TasksNewTaskPrefs {
  if (!raw) return DEFAULT_TASKS_NEW_TASK_PREFS;
  try {
    const record = JSON.parse(raw) as { priority?: unknown; status?: unknown } | null;
    const priority = NEW_TASK_PRIORITIES.find((value) => value === record?.priority);
    const status = NEW_TASK_STATUSES.find((value) => value === record?.status);
    return {
      priority: priority ?? DEFAULT_TASKS_NEW_TASK_PREFS.priority,
      status: status ?? DEFAULT_TASKS_NEW_TASK_PREFS.status,
    };
  } catch {
    return DEFAULT_TASKS_NEW_TASK_PREFS;
  }
}

export function readTasksNewTaskPrefs(): TasksNewTaskPrefs {
  try {
    return parseTasksNewTaskPrefs(window.localStorage.getItem(TASKS_NEW_TASK_PREFS_STORAGE_KEY));
  } catch {
    return DEFAULT_TASKS_NEW_TASK_PREFS;
  }
}

/** False when the write throws (quota / private mode). */
export function writeTasksNewTaskPrefs(prefs: TasksNewTaskPrefs): boolean {
  try {
    window.localStorage.setItem(TASKS_NEW_TASK_PREFS_STORAGE_KEY, JSON.stringify(prefs));
    return true;
  } catch {
    return false;
  }
}

/** The stored defaults, following a change made in Settings (this tab or another). */
export function useTasksNewTaskPrefs(): TasksNewTaskPrefs {
  const [prefs, setPrefs] = useState(readTasksNewTaskPrefs);
  useEffect(
    () =>
      subscribeSettingsSliceSaved((event) => {
        if (event.sliceId === TASKS_NEW_TASK_PREFS_SLICE.sliceId) setPrefs(readTasksNewTaskPrefs());
      }),
    [],
  );
  return prefs;
}
