/**
 * Path-based tasks routing utilities.
 *
 * URL structure:
 *   /tasks/state/all
 *   /tasks/state/today
 *   /tasks/lists/:listId
 *   /tasks/priority/:prioritySlug
 */

import { INBOX_TASK_LIST_ID, isInboxTaskList } from "@/tasks-core/src/tasks-task-utils";

export const DEFAULT_TASKS_VIEW = "state:all";

export type TasksRouteParams = {
  stateSlug?: string;
  listId?: string;
  prioritySlug?: string;
};

type TaskListRouteEntry = {
  id: string;
  role?: string | null;
  isSharee?: boolean;
};

/** True only for the tasks app prefix — never `/calendar`, `/contacts`, etc. */
export function isTasksPathname(pathname: string): boolean {
  return pathname === "/tasks" || pathname.startsWith("/tasks/");
}

/** Derive the controller `view` string from the matched path and params. */
export function tasksViewFromLocation(pathname: string, params: TasksRouteParams): string {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "tasks") return DEFAULT_TASKS_VIEW;

  const segment = parts[1] ? decodeURIComponent(parts[1]) : "state";
  const slugFromPath = parts[2] ? decodeURIComponent(parts[2]) : undefined;

  if (segment === "state") {
    const stateSlug = slugFromPath ?? params.stateSlug;
    if (stateSlug) {
      return `state:${decodeURIComponent(stateSlug)}`;
    }
    return DEFAULT_TASKS_VIEW;
  }
  if (segment === "tags") {
    return DEFAULT_TASKS_VIEW;
  }
  if (segment === "lists") {
    const listId = slugFromPath ?? params.listId;
    if (listId) {
      return `list:${decodeURIComponent(listId)}`;
    }
  }
  if (segment === "priority") {
    const prioritySlug = slugFromPath ?? params.prioritySlug;
    if (prioritySlug) {
      return `priority:${decodeURIComponent(prioritySlug)}`;
    }
  }
  return DEFAULT_TASKS_VIEW;
}

/** Map inbox aliases (e.g. legacy `inbox` slug) to the canonical list id from bootstrap. */
export function normalizeTasksView(view: string, taskLists: TaskListRouteEntry[]): string {
  if (view.startsWith("tag:")) view = DEFAULT_TASKS_VIEW;
  if (!view.startsWith("list:")) return view;

  const listId = view.slice(5);
  const matchedList = taskLists.find((list) => list.id === listId);
  if (matchedList && isInboxTaskList(matchedList)) {
    return `list:${matchedList.id}`;
  }

  if (listId === INBOX_TASK_LIST_ID) {
    const inbox = taskLists.find(isInboxTaskList);
    if (inbox) return `list:${inbox.id}`;
  }

  return view;
}

export type TasksNavigateTarget = {
  to:
    | "/tasks/state/all"
    | "/tasks/state/$stateSlug"
    | "/tasks/lists/$listId"
    | "/tasks/priority/$prioritySlug";
  params: Record<string, string>;
};

export function tasksNavigateTarget(view: string): TasksNavigateTarget {
  if (view.startsWith("tag:")) {
    return { to: "/tasks/state/all", params: {} };
  }
  if (view.startsWith("state:")) {
    const stateSlug = encodeURIComponent(view.slice(6));
    if (stateSlug === "all") {
      return { to: "/tasks/state/all", params: {} };
    }
    return { to: "/tasks/state/$stateSlug", params: { stateSlug } };
  }
  if (view.startsWith("list:")) {
    const listId = encodeURIComponent(view.slice(5));
    return { to: "/tasks/lists/$listId", params: { listId } };
  }
  if (view.startsWith("priority:")) {
    const prioritySlug = encodeURIComponent(view.slice(9));
    return { to: "/tasks/priority/$prioritySlug", params: { prioritySlug } };
  }
  return { to: "/tasks/state/all", params: {} };
}
