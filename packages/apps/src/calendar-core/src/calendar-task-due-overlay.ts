import { Temporal } from "@js-temporal/polyfill";
import type { CalendarEvent, CalendarEventsMap } from "@/lib/calendar-engine";
import type { Task, TaskList } from "@/lib/models/tasks-types";
import { TASK_DUE_OVERLAY_KIND, taskDueOverlayKey } from "@/lib/calendar/calendar-render-overlay";
import {
  isTaskCompleted,
  parseDueDateValue,
  taskDueIsDateOnly,
  taskListDotColor,
  taskListTitle,
} from "@/tasks-core/src/tasks-task-utils";

export const TASK_DUE_OVERLAY_TIMED_DURATION = Temporal.Duration.from({ minutes: 30 });
export const TASK_DUE_OVERLAY_ALL_DAY_DURATION = Temporal.Duration.from({ days: 1 });

export type TaskDueOverlayMarker = {
  key: string;
  taskId: string;
  taskListId: string;
  listName: string;
  listColor: string;
  title: string;
  due: string;
  allDay: boolean;
  event: CalendarEvent;
};

export type TaskDueOverlayModel = {
  events: CalendarEventsMap;
  markers: TaskDueOverlayMarker[];
  taskLists: TaskList[];
};

export function tasksListTaskHref(listId: string, taskId: string): string {
  return `/tasks/lists/${encodeURIComponent(listId)}?task=${encodeURIComponent(taskId)}`;
}

function padDuePart(value: number): string {
  return String(value).padStart(2, "0");
}

function dueToPlainDateTime(due: Date, allDay: boolean): Temporal.PlainDateTime {
  if (allDay) {
    return Temporal.PlainDateTime.from({
      year: due.getFullYear(),
      month: due.getMonth() + 1,
      day: due.getDate(),
      hour: 0,
      minute: 0,
      second: 0,
    });
  }
  return Temporal.PlainDateTime.from({
    year: due.getFullYear(),
    month: due.getMonth() + 1,
    day: due.getDate(),
    hour: due.getHours(),
    minute: due.getMinutes(),
    second: due.getSeconds(),
  });
}

export function mapTaskToDueOverlayMarker(
  task: Task,
  lists: readonly TaskList[],
): TaskDueOverlayMarker | null {
  if (isTaskCompleted(task)) return null;
  const dueRaw = task.due?.trim();
  if (!dueRaw) return null;
  const dueDate = parseDueDateValue(dueRaw);
  if (!dueDate) return null;

  const allDay = taskDueIsDateOnly(dueRaw, task.showWithoutTime);
  const list = lists.find((entry) => entry.id === task.taskListId);
  const listColor = taskListDotColor(list ?? task.taskListId);
  const listName = list?.name?.trim() || task.taskListId;
  const title = taskListTitle(task, "");
  const key = taskDueOverlayKey(task.id);
  const start = dueToPlainDateTime(dueDate, allDay);
  const event: CalendarEvent = {
    overlayKind: TASK_DUE_OVERLAY_KIND,
    overlayTaskListId: task.taskListId,
    eventId: key,
    data: {
      start,
      allDay,
      summary: title,
      color: listColor,
      duration: allDay ? TASK_DUE_OVERLAY_ALL_DAY_DURATION : TASK_DUE_OVERLAY_TIMED_DURATION,
    },
  };

  return {
    key,
    taskId: task.id,
    taskListId: task.taskListId,
    listName,
    listColor,
    title,
    due: dueRaw,
    allDay,
    event,
  };
}

export function buildTaskDueOverlayModel(
  tasks: readonly Task[],
  taskLists: readonly TaskList[],
  options: {
    hiddenListIds?: ReadonlySet<string>;
    range?: { start: Temporal.PlainDateTime; end: Temporal.PlainDateTime };
  } = {},
): TaskDueOverlayModel {
  const hidden = options.hiddenListIds ?? new Set<string>();
  const markers: TaskDueOverlayMarker[] = [];
  const events: CalendarEventsMap = new Map();

  for (const task of tasks) {
    if (hidden.has(task.taskListId)) continue;
    const marker = mapTaskToDueOverlayMarker(task, taskLists);
    if (!marker) continue;
    if (options.range && !taskDueOverlapsRange(marker.event, options.range)) continue;
    markers.push(marker);
    events.set(marker.key, marker.event);
  }

  return { events, markers, taskLists: [...taskLists] };
}

export function taskDueOverlapsRange(
  event: CalendarEvent,
  range: { start: Temporal.PlainDateTime; end: Temporal.PlainDateTime },
): boolean {
  const start = event.data.start;
  const end = event.data.duration ? start.add(event.data.duration) : (event.data.end ?? start);
  return (
    Temporal.PlainDateTime.compare(start, range.end) < 0 &&
    Temporal.PlainDateTime.compare(end, range.start) > 0
  );
}

export function formatTaskDueOverlayWhen(due: string, allDay: boolean, locale: string): string {
  const date = parseDueDateValue(due);
  if (!date) return due;
  if (allDay) {
    return date.toLocaleDateString(locale, { weekday: "short", month: "short", day: "numeric" });
  }
  return date.toLocaleString(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Debug / test helper — local wall timestamp for a due day. */
export function localDueStamp(date: Date, time?: string): string {
  const day = `${date.getFullYear()}-${padDuePart(date.getMonth() + 1)}-${padDuePart(date.getDate())}`;
  return time ? `${day}T${time}` : day;
}
