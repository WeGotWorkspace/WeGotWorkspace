import type { Task } from "@/lib/models/tasks-types";

/** Task fields that Tasks and the Calendar task-due overlay both read (#2116). */

export function taskListTitle(task: Task, fallback: string): string {
  const title = task.title?.trim();
  return title || fallback;
}

export function parseDueDateValue(raw: string | null | undefined): Date | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dateOnly) {
    return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  }
  const dateTime = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(trimmed);
  if (dateTime) {
    return new Date(
      Number(dateTime[1]),
      Number(dateTime[2]) - 1,
      Number(dateTime[3]),
      Number(dateTime[4]),
      Number(dateTime[5]),
      Number(dateTime[6] ?? 0),
    );
  }
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function taskDueIsDateOnly(
  due: string | null | undefined,
  showWithoutTime?: boolean | null,
): boolean {
  if (!due?.trim()) return true;
  if (showWithoutTime === true) return true;
  if (showWithoutTime === false) return false;
  return !/T\d{2}:\d{2}/.test(due);
}

export function isTaskCompleted(task: Task): boolean {
  return task.workflowStatus === "completed" || task.workflowStatus === "cancelled";
}
