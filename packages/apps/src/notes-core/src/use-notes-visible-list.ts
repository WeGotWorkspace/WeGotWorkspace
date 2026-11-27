import { useMemo } from "react";
import { useListSort } from "@/hooks/use-list-sort";
import { filterNotesByHiddenNotebooks, filterVisibleNotes } from "./notes-note-utils";
import {
  NOTES_DEFAULT_SORT,
  NOTES_SORT_FIRST_DIRECTION,
  NOTES_SORT_STORAGE_KEY,
  sortNotes,
} from "./notes-list-sort";
import { sharedNotebookFilterKeys } from "./use-notes-sidebar-model";
import type { NotesShellState } from "./use-notes-shell";

/** Filtered and sorted notes for the current view, plus the list sort state. */
export function useNotesVisibleList(shell: NotesShellState) {
  const { notes, view, searchQuery, starred, archived, hiddenNotebookIds, notebookCollections } =
    shell;

  const sharedNotebookKeys = useMemo(
    () => sharedNotebookFilterKeys(notebookCollections),
    [notebookCollections],
  );

  const { sort: listSort, chooseSort: setListSort } = useListSort({
    columns: NOTES_SORT_FIRST_DIRECTION,
    defaultSort: NOTES_DEFAULT_SORT,
    storageKey: NOTES_SORT_STORAGE_KEY,
  });

  const visibleNotes = useMemo(
    () =>
      sortNotes(
        filterNotesByHiddenNotebooks(
          filterVisibleNotes(notes, {
            view,
            archived,
            starred,
            searchQuery,
            sharedNotebookKeys,
            notebookCollections,
          }),
          view,
          hiddenNotebookIds,
        ),
        listSort,
      ),
    [
      archived,
      listSort,
      hiddenNotebookIds,
      notebookCollections,
      notes,
      searchQuery,
      sharedNotebookKeys,
      starred,
      view,
    ],
  );

  return { visibleNotes, listSort, setListSort };
}
