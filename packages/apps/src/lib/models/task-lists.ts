/**
 * Task list identity, rights, colour and sidebar order (#2116). Tasks and the
 * Calendar task-due overlay both use these.
 */

export const INBOX_TASK_LIST_ID = "inbox";
export const INBOX_TASK_LIST_URI = "tasks-inbox";

export type TaskListIdentity = {
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

export function canWriteTaskList(list?: { myRights?: { mayWriteAll?: boolean } | null }): boolean {
  return list?.myRights?.mayWriteAll !== false;
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

export type TaskListSidebarEntry = {
  id: string;
  name: string;
  role?: string | null;
  color?: string | null;
  isSharee?: boolean;
  isDefault?: boolean;
  myRights?: { mayWriteAll?: boolean; mayShare?: boolean } | null;
};

function isPinnedSidebarInbox(list: TaskListSidebarEntry): boolean {
  if (list.role === "inbox") return true;
  if (isInboxTaskList(list)) return true;
  if (list.isSharee) return false;
  return list.isDefault === true;
}

/** Inbox first, then locale-aware A–Z. Shared and owned sections both use this. */
export function sortSidebarTaskLists<T extends TaskListSidebarEntry>(lists: readonly T[]): T[] {
  return [...lists].sort((left, right) => {
    const leftInbox = isPinnedSidebarInbox(left);
    const rightInbox = isPinnedSidebarInbox(right);
    if (leftInbox !== rightInbox) return leftInbox ? -1 : 1;
    return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  });
}
