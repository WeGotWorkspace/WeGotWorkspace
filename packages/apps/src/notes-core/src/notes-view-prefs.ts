import { resolveHiddenCollectionIds } from "@/collection-sidebar/src/collection-hidden-ids";

export const NOTES_VIEW_PREFS_STORAGE_KEY = "wgw.ui.notes.viewPrefs";

export type NotesViewPrefs = {
  hiddenNotebookIds?: string[];
  /** Notebook ids present the last time hidden prefs were written on this device. */
  knownNotebookIds?: string[];
};

function hasWindowStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function parseStoredIdList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((id): id is string => typeof id === "string" && id.length > 0);
}

export function parseNotesViewPrefs(raw: string | null): NotesViewPrefs | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const prefs: NotesViewPrefs = {};
    const hiddenNotebookIds = parseStoredIdList(record.hiddenNotebookIds);
    if (hiddenNotebookIds !== undefined) prefs.hiddenNotebookIds = hiddenNotebookIds;
    const knownNotebookIds = parseStoredIdList(record.knownNotebookIds);
    if (knownNotebookIds !== undefined) prefs.knownNotebookIds = knownNotebookIds;
    return Object.keys(prefs).length > 0 ? prefs : null;
  } catch {
    return null;
  }
}

export function readNotesViewPrefs(): NotesViewPrefs | null {
  if (!hasWindowStorage()) return null;
  try {
    return parseNotesViewPrefs(window.localStorage.getItem(NOTES_VIEW_PREFS_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function writeNotesViewPrefs(prefs: NotesViewPrefs): void {
  if (!hasWindowStorage()) return;
  try {
    window.localStorage.setItem(NOTES_VIEW_PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore storage failures (private mode, quota).
  }
}

export function persistHiddenNotebookIds(
  ids: ReadonlySet<string>,
  notebookIds: ReadonlyArray<string>,
): void {
  writeNotesViewPrefs({
    hiddenNotebookIds: [...ids],
    knownNotebookIds: [...new Set(notebookIds.filter((id) => id.length > 0))],
  });
}

export function resolveHiddenNotebookIds(
  notebooks: ReadonlyArray<{ id: string; isVisible?: boolean }>,
  persisted?: NotesViewPrefs | null,
): string[] {
  return resolveHiddenCollectionIds(notebooks, {
    hiddenIds: persisted?.hiddenNotebookIds,
    knownIds: persisted?.knownNotebookIds,
  });
}
