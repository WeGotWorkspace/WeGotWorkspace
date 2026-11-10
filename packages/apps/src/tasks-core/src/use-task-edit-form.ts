import { useEffect, useRef, useState } from "react";
import type { Task } from "@/lib/models/tasks-types";
import {
  emptyTaskForm,
  taskToFormValue,
  type TasksTaskFormValue,
} from "@/tasks-core/src/tasks-task-form";

/** Fields that change together: the due picker sets them as one value. */
const FORM_FIELD_GROUPS: (keyof TasksTaskFormValue)[][] = [
  ["title"],
  ["description"],
  ["listId"],
  ["workflowStatus"],
  ["priority"],
  ["due", "showWithoutTime", "timeZone"],
  ["alerts"],
];

function sameFieldValue(a: unknown, b: unknown): boolean {
  return Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Folds a newer copy of the task into the open form (#1858). Fields the
 * person changed since `base` keep their value; untouched fields take the
 * newer copy, so saving does not revert someone else's change.
 */
export function rebaseTaskForm(
  current: TasksTaskFormValue,
  base: TasksTaskFormValue,
  next: TasksTaskFormValue,
): TasksTaskFormValue {
  const merged = { ...current };
  for (const group of FORM_FIELD_GROUPS) {
    const edited = group.some((key) => !sameFieldValue(current[key], base[key]));
    if (edited) continue;
    for (const key of group) Object.assign(merged, { [key]: next[key] });
  }
  return merged;
}

/**
 * The form is seeded when the dialog opens or switches to another task.
 * A newer copy of the same task (sync, other tab) keeps the person's edits.
 * A read-only task has no draft, so its form always mirrors the task.
 */
export function useTaskEditForm(task: Task | null, readOnly: boolean) {
  const [form, setForm] = useState(() => emptyTaskForm(task?.taskListId ?? "default"));
  const seeded = useRef<{ taskId: string; base: TasksTaskFormValue } | null>(null);

  useEffect(() => {
    if (!task) {
      seeded.current = null;
      return;
    }
    const next = taskToFormValue(task, task.taskListId);
    const previous = seeded.current;
    seeded.current = { taskId: task.id, base: next };
    if (!previous || previous.taskId !== task.id || readOnly) {
      setForm(next);
      return;
    }
    setForm((current) => rebaseTaskForm(current, previous.base, next));
  }, [task, readOnly]);

  return [form, setForm] as const;
}
