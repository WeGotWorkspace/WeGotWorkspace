import { resolveHiddenCollectionIds } from "@/collection-sidebar/src/collection-hidden-ids";

export const TASKS_VIEW_PREFS_STORAGE_KEY = "wgw.ui.tasks.viewPrefs";

export type TasksViewPrefs = {
  hiddenTaskListIds?: string[];
  /** List ids present the last time hidden prefs were written on this device. */
  knownTaskListIds?: string[];
};

function hasWindowStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function parseStoredIdList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((id): id is string => typeof id === "string" && id.length > 0);
}

export function parseTasksViewPrefs(raw: string | null): TasksViewPrefs | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const prefs: TasksViewPrefs = {};
    const hiddenTaskListIds = parseStoredIdList(record.hiddenTaskListIds);
    if (hiddenTaskListIds !== undefined) prefs.hiddenTaskListIds = hiddenTaskListIds;
    const knownTaskListIds = parseStoredIdList(record.knownTaskListIds);
    if (knownTaskListIds !== undefined) prefs.knownTaskListIds = knownTaskListIds;
    return Object.keys(prefs).length > 0 ? prefs : null;
  } catch {
    return null;
  }
}

export function readTasksViewPrefs(): TasksViewPrefs | null {
  if (!hasWindowStorage()) return null;
  try {
    return parseTasksViewPrefs(window.localStorage.getItem(TASKS_VIEW_PREFS_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function writeTasksViewPrefs(prefs: TasksViewPrefs): void {
  if (!hasWindowStorage()) return;
  try {
    window.localStorage.setItem(TASKS_VIEW_PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore storage failures (private mode, quota).
  }
}

export function persistHiddenTaskListIds(
  ids: ReadonlySet<string>,
  listIds: ReadonlyArray<string>,
): void {
  writeTasksViewPrefs({
    hiddenTaskListIds: [...ids],
    knownTaskListIds: [...new Set(listIds.filter((id) => id.length > 0))],
  });
}

export function resolveHiddenTaskListIds(
  lists: ReadonlyArray<{ id: string; isVisible?: boolean }>,
  persisted?: TasksViewPrefs | null,
): string[] {
  return resolveHiddenCollectionIds(lists, {
    hiddenIds: persisted?.hiddenTaskListIds,
    knownIds: persisted?.knownTaskListIds,
  });
}
