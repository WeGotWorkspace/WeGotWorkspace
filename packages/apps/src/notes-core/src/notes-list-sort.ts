import type { Note } from "@/lib/models/note";
import {
  compareListNumber,
  compareListText,
  type ListSort,
  type ListSortDirection,
} from "@/lib/list-sort";
import type { ListSortOption } from "@/list-sort-menu/src/list-sort-menu";
import { parseNoteTimestamp } from "@/notes-core/src/notes-date-utils";
import type { NotesUILabels } from "@/notes-core/src/notes-labels";
import { noteListTitle } from "@/notes-core/src/notes-note-utils";

export type NotesSortKey = "modified" | "title";

export type NotesListSort = ListSort<NotesSortKey>;

/** Direction a key starts in: newest first for dates, A to Z for titles. */
export const NOTES_SORT_FIRST_DIRECTION: Readonly<Record<NotesSortKey, ListSortDirection>> = {
  modified: "desc",
  title: "asc",
};

/** Same as the list always was before the sort control: newest edit first. */
export const NOTES_DEFAULT_SORT: NotesListSort = { key: "modified", direction: "desc" };

export const NOTES_SORT_STORAGE_KEY = "wgw.notes.listSort";

export function notesSortOptions(L: NotesUILabels): ListSortOption<NotesSortKey>[] {
  return [
    {
      key: "modified",
      label: L.sortModified,
      ascendingLabel: L.sortOldestFirst,
      descendingLabel: L.sortNewestFirst,
    },
    {
      key: "title",
      label: L.sortTitle,
      ascendingLabel: L.sortAToZ,
      descendingLabel: L.sortZToA,
    },
  ];
}

/** Sorts in place and returns the array. Ties break on id so the order is stable. */
export function sortNotes<T extends Pick<Note, "id" | "date" | "title" | "excerpt" | "body">>(
  notes: T[],
  sort: NotesListSort,
): T[] {
  // filterVisibleNotes already hands the list over newest-edit first.
  if (sort.key === "modified" && sort.direction === "desc") return notes;
  const sign = sort.direction === "asc" ? 1 : -1;
  if (sort.key === "modified") {
    // Missing dates sort last in both directions, like the default order.
    return notes.sort((a, b) => {
      const byDate = compareListNumber(
        parseNoteTimestamp(a.date) ?? undefined,
        parseNoteTimestamp(b.date) ?? undefined,
        "asc",
      );
      if (byDate !== 0) {
        const aMissing = parseNoteTimestamp(a.date) === null;
        const bMissing = parseNoteTimestamp(b.date) === null;
        return aMissing || bMissing ? byDate : byDate * sign;
      }
      return a.id.localeCompare(b.id) * sign;
    });
  }
  return notes.sort((a, b) => {
    const byTitle = compareListText(noteListTitle(a), noteListTitle(b));
    return byTitle !== 0 ? byTitle * sign : a.id.localeCompare(b.id) * sign;
  });
}
