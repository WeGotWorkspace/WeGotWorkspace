import type { Task, TaskAlert } from "@/tasks-core/src/tasks-types";
import {
  isTaskPriorityNone,
  normalizeTaskPriority,
  priorityFromFilterSlug,
} from "@/tasks-core/src/tasks-priority";

export const TASK_WORKFLOW_STATUSES = [
  "needs-action",
  "in-process",
  "completed",
  "cancelled",
] as const;

export type TaskWorkflowStatus = (typeof TASK_WORKFLOW_STATUSES)[number];

export function normalizeTag(tag: string): string {
  return tag.trim();
}

export function taskListTitle(task: Task, fallback: string): string {
  const title = task.title?.trim();
  return title || fallback;
}

/** Preserve optimistic fields when the create API response omits them. */
export function mergeCreatedTask(optimistic: Task, created: Task): Task {
  const createdDue = parseDueDateValue(created.due);
  return {
    ...optimistic,
    ...created,
    workflowStatus: created.workflowStatus ?? optimistic.workflowStatus,
    priority: isTaskPriorityNone(created.priority) ? optimistic.priority : created.priority,
    due: createdDue !== undefined ? created.due : optimistic.due,
    showWithoutTime:
      created.showWithoutTime !== undefined ? created.showWithoutTime : optimistic.showWithoutTime,
    timeZone: created.timeZone !== undefined ? created.timeZone : optimistic.timeZone,
    alerts: created.alerts !== undefined ? created.alerts : optimistic.alerts,
  };
}

function parseDueDate(task: Task): Date | null {
  return parseDueDateValue(task.due) ?? null;
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

function padDuePart(value: number): string {
  return String(value).padStart(2, "0");
}

export function dueDateToApiValue(date: Date): string {
  return `${date.getFullYear()}-${padDuePart(date.getMonth() + 1)}-${padDuePart(date.getDate())}`;
}

export function dueDateTimeToApiValue(date: Date): string {
  return `${dueDateToApiValue(date)}T${padDuePart(date.getHours())}:${padDuePart(date.getMinutes())}:${padDuePart(date.getSeconds())}`;
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

export function dueTimeInputValue(date: Date): string {
  return `${padDuePart(date.getHours())}:${padDuePart(date.getMinutes())}`;
}

export function applyDueTime(date: Date, time: string): Date {
  const [hours, minutes] = time.split(":").map(Number);
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    Number.isFinite(hours) ? hours : 0,
    Number.isFinite(minutes) ? minutes : 0,
    0,
  );
}

export const DEFAULT_TASK_DUE_TIME = "09:00";

export type TaskDueFields = {
  due: string | null;
  showWithoutTime: boolean;
  timeZone: string | null;
};

/** Default composer due date for time-filter sidebar views; null for all other views. */
export function composerDefaultDueForView(view: string, now: Date = new Date()): string | null {
  const today = startOfLocalDay(now);
  if (view === "state:today") return dueDateToApiValue(today);
  if (view === "state:upcoming") {
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return dueDateToApiValue(tomorrow);
  }
  if (view === "state:overdue") {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    return dueDateToApiValue(yesterday);
  }
  return null;
}

export function formatDueDateShort(date: Date): string {
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatComposerDueDateLabel(
  date: Date,
  labels: { dueToday: string; dueYesterday: string; dueTomorrow: string },
  now: Date = new Date(),
): string {
  const dueDay = startOfLocalDay(date);
  const today = startOfLocalDay(now);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (dueDay.getTime() === today.getTime()) return labels.dueToday;
  if (dueDay.getTime() === yesterday.getTime()) return labels.dueYesterday;
  if (dueDay.getTime() === tomorrow.getTime()) return labels.dueTomorrow;
  return formatDueDateShort(date);
}

export function formatDueTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function formatComposerDueLabel(
  due: string | null | undefined,
  showWithoutTime: boolean | null | undefined,
  labels: { dueToday: string; dueYesterday: string; dueTomorrow: string },
  now: Date = new Date(),
): string | null {
  const date = parseDueDateValue(due);
  if (!date) return null;
  const datePart = formatComposerDueDateLabel(date, labels, now);
  if (taskDueIsDateOnly(due, showWithoutTime)) return datePart;
  return `${datePart}, ${formatDueTime(date)}`;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function isCompleted(task: Task): boolean {
  return task.workflowStatus === "completed" || task.workflowStatus === "cancelled";
}

/** Aggregate views hide tasks from lists the user unchecked. A list view stays unfiltered. */
export function filterTasksByHiddenLists(
  tasks: Task[],
  view: string,
  hiddenListIds: ReadonlySet<string>,
): Task[] {
  if (hiddenListIds.size === 0 || view.startsWith("list:")) return tasks;
  return tasks.filter((task) => !hiddenListIds.has(task.taskListId));
}

export function filterTasksByView(tasks: Task[], view: string): Task[] {
  if (view.startsWith("tag:")) {
    const tag = normalizeTag(view.slice(4));
    return tasks.filter((task) => (task.categories ?? []).some((c) => normalizeTag(c) === tag));
  }

  if (view.startsWith("list:")) {
    const listId = view.slice(5);
    return tasks.filter((task) => task.taskListId === listId);
  }

  if (view.startsWith("priority:")) {
    const slug = view.slice(9);
    if (slug === "none") {
      return tasks.filter((task) => isTaskPriorityNone(task.priority));
    }
    const priority = priorityFromFilterSlug(slug);
    if (priority === null) return tasks;
    return tasks.filter((task) => normalizeTaskPriority(task.priority) === priority);
  }

  if (!view.startsWith("state:")) {
    return tasks;
  }

  const state = view.slice(6);
  if (state === "all") return tasks;

  const today = startOfLocalDay(new Date());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (state === "needs-action") {
    return tasks.filter((task) => task.workflowStatus === "needs-action");
  }

  if (state === "in-process") {
    return tasks.filter((task) => task.workflowStatus === "in-process");
  }

  if (state === "completed") {
    return tasks.filter((task) => task.workflowStatus === "completed");
  }

  if (state === "cancelled") {
    return tasks.filter((task) => task.workflowStatus === "cancelled");
  }

  if (state === "today") {
    return tasks.filter((task) => {
      const due = parseDueDate(task);
      if (!due) return false;
      const dueDay = startOfLocalDay(due);
      return dueDay.getTime() <= today.getTime() && !isCompleted(task);
    });
  }

  if (state === "upcoming") {
    return tasks.filter((task) => {
      const due = parseDueDate(task);
      if (!due || isCompleted(task)) return false;
      return startOfLocalDay(due).getTime() >= tomorrow.getTime();
    });
  }

  if (state === "overdue") {
    return tasks.filter((task) => {
      const due = parseDueDate(task);
      if (!due || isCompleted(task)) return false;
      return startOfLocalDay(due).getTime() < today.getTime();
    });
  }

  return tasks;
}

export function filterTasksBySearch(tasks: Task[], query: string): Task[] {
  const q = query.trim().toLowerCase();
  if (!q) return tasks;
  return tasks.filter((task) => {
    const title = task.title?.toLowerCase() ?? "";
    const description = task.description?.toLowerCase() ?? "";
    const tags = (task.categories ?? []).join(" ").toLowerCase();
    return title.includes(q) || description.includes(q) || tags.includes(q);
  });
}

export function collectTaskTags(tasks: Task[]): string[] {
  const tags = new Set<string>();
  for (const task of tasks) {
    for (const tag of task.categories ?? []) {
      const normalized = normalizeTag(tag);
      if (normalized) tags.add(normalized);
    }
  }
  return [...tags].sort((a, b) => a.localeCompare(b));
}

export const INBOX_TASK_LIST_ID = "inbox";
export const INBOX_TASK_LIST_URI = "tasks-inbox";

type TaskListIdentity = {
  id: string;
  role?: string | null;
  isSharee?: boolean;
  isDefault?: boolean;
};

/** Owned personal Inbox only — never display name, never an inbound shared Inbox. */
export function isInboxTaskList(list: TaskListIdentity): boolean {
  if (list.isSharee) return false;
  if (list.role === "inbox") return true;
  return list.id === INBOX_TASK_LIST_ID || list.id === INBOX_TASK_LIST_URI;
}

export function isProtectedTaskList(list: TaskListIdentity): boolean {
  return isInboxTaskList(list);
}

export type TaskListWriteInfo = {
  id?: string;
  role?: string | null;
  isSharee?: boolean;
  isDefault?: boolean;
  scope?: "personal" | "group" | null;
  groupSlug?: string | null;
  myRights?: { mayDelete?: boolean; mayShare?: boolean } | null;
};

/**
 * Provisioned group home (e.g. Team / Administrators) — API `role: "group"` or
 * `id === group-{slug}`. Same lock as Notes / Calendar.
 */
export function isProvisionedGroupTaskList(list?: TaskListWriteInfo): boolean {
  if (!list) return false;
  if (list.role === "group") return true;
  const slug = list.groupSlug?.trim();
  return list.scope === "group" && Boolean(slug) && list.id === `group-${slug}`;
}

/**
 * Owner delete in the list dialog — same gate as Notes `canDeleteNotebook`.
 * Sharees use remove-shared; Inbox, `isDefault`, and provisioned group homes
 * cannot be destroyed (`myRights.mayDelete: false` on the API).
 */
export function canDeleteTaskList(list?: TaskListWriteInfo): boolean {
  const listId = list?.id;
  if (!listId) return false;
  if (list.isSharee === true) return false;
  if (
    isInboxTaskList({
      id: listId,
      role: list.role,
      isSharee: list.isSharee,
      isDefault: list.isDefault,
    })
  ) {
    return false;
  }
  if (list.isDefault) return false;
  if (isProvisionedGroupTaskList(list)) return false;
  if (list.myRights?.mayDelete === false) return false;
  return true;
}

export function canWriteTaskList(list?: { myRights?: { mayWriteAll?: boolean } | null }): boolean {
  return list?.myRights?.mayWriteAll !== false;
}

export function canShareTaskList(list?: { myRights?: { mayShare?: boolean } | null }): boolean {
  return list?.myRights?.mayShare === true;
}

/**
 * Move Owner between personal and group (same options as create).
 * Inbox, default, provisioned group, and sharees stay locked.
 */
export function canChangeTaskListOwner(list?: TaskListWriteInfo): boolean {
  const listId = list?.id;
  if (!listId) return false;
  if (
    isInboxTaskList({
      id: listId,
      role: list.role,
      isSharee: list.isSharee,
      isDefault: list.isDefault,
    })
  ) {
    return false;
  }
  if (list.isDefault) return false;
  if (list.isSharee) return false;
  if (!canShareTaskList(list)) return false;
  if (isProvisionedGroupTaskList(list)) return false;
  return true;
}

export function defaultTaskListId(taskLists: TaskListIdentity[]): string {
  const inbox = taskLists.find(isInboxTaskList);
  if (inbox) return inbox.id;
  const owned = taskLists.filter((list) => !list.isSharee);
  const preferred = owned.find((list) => list.isDefault) ?? owned[0] ?? taskLists[0];
  return preferred?.id ?? INBOX_TASK_LIST_ID;
}

export const TASK_LIST_DOT_COLORS = [
  "#ea8c72",
  "#6366f1",
  "#f59e0b",
  "#ec4899",
  "#22c55e",
  "#3b82f6",
] as const;

export const DEFAULT_TASK_LIST_COLOR = TASK_LIST_DOT_COLORS[1];

type TaskListColorSource = {
  id: string;
  color?: string | null;
};

function hashTaskListColor(seed: string): string {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return TASK_LIST_DOT_COLORS[hash % TASK_LIST_DOT_COLORS.length] ?? TASK_LIST_DOT_COLORS[0];
}

export function taskListDotColor(list: string | TaskListColorSource): string {
  if (typeof list === "string") {
    return hashTaskListColor(list);
  }

  const explicitColor = list.color?.trim();
  if (explicitColor) return explicitColor;

  return hashTaskListColor(list.id);
}

export function taskListName(
  listId: string | null | undefined,
  taskLists: { id: string; name: string }[],
): string {
  if (!listId) return "";
  return taskLists.find((list) => list.id === listId)?.name ?? listId;
}

export function isTaskCompleted(task: Task): boolean {
  return task.workflowStatus === "completed" || task.workflowStatus === "cancelled";
}

/** Views where the header toggle can hide completed tasks from the list. */
export function shouldApplyCompletedTaskFilter(view: string): boolean {
  return view !== "state:completed" && view !== "state:cancelled";
}

export function filterHiddenCompletedTasks(tasks: Task[]): Task[] {
  return tasks.filter((task) => !isTaskCompleted(task));
}

/** Views where a completed task would remain visible until explicitly hidden. */
export function shouldHideCompletedTaskAfterExit(view: string): boolean {
  if (view === "state:all") return true;
  if (view.startsWith("tag:") || view.startsWith("list:") || view.startsWith("priority:"))
    return true;
  return false;
}

export function buildDisplayTasks(
  tasks: Task[],
  visibleTasks: Task[],
  exitingTaskIds: ReadonlySet<string>,
  hiddenTaskIds: ReadonlySet<string>,
): Task[] {
  const visibleIds = new Set(visibleTasks.map((task) => task.id));
  const displayIds = new Set<string>();
  for (const task of visibleTasks) {
    if (!hiddenTaskIds.has(task.id)) displayIds.add(task.id);
  }
  for (const taskId of exitingTaskIds) {
    if (visibleIds.has(taskId) || tasks.some((task) => task.id === taskId)) {
      displayIds.add(taskId);
    }
  }
  return tasks.filter((task) => displayIds.has(task.id));
}

export function formatTaskDue(task: Task): string | null {
  const due = parseDueDate(task);
  if (!due) return null;
  return due.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: task.showWithoutTime ? undefined : "numeric",
    minute: task.showWithoutTime ? undefined : "2-digit",
  });
}

export function statusLabel(
  status: string | null | undefined,
  labels: {
    statusNeedsAction: string;
    statusInProcess: string;
    statusCompleted: string;
    statusCancelled: string;
  },
): string {
  switch (status) {
    case "needs-action":
      return labels.statusNeedsAction;
    case "in-process":
      return labels.statusInProcess;
    case "completed":
      return labels.statusCompleted;
    case "cancelled":
      return labels.statusCancelled;
    default:
      return labels.statusNeedsAction;
  }
}

export function taskAlertsFromList(alerts: TaskAlert[] | null): Task["alerts"] | undefined {
  if (!alerts || alerts.length === 0) return undefined;
  const map: Record<string, TaskAlert> = {};
  alerts.forEach((alert, index) => {
    map[`alert${index + 1}`] = alert;
  });
  return map;
}

export function taskAlertsEqual(
  a: Task["alerts"] | null | undefined,
  b: Task["alerts"] | null | undefined,
): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export function offsetReminderAlert(offset: string): TaskAlert {
  return {
    "@type": "Alert",
    trigger: {
      "@type": "OffsetTrigger",
      offset,
      relativeTo: "end",
    },
    action: "display",
  };
}

export function absoluteReminderAlert(when: string): TaskAlert {
  return {
    "@type": "Alert",
    trigger: {
      "@type": "AbsoluteTrigger",
      when,
    },
    action: "display",
  };
}
