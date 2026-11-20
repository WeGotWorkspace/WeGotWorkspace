import { useEffect, useMemo } from "react";
import type { Note } from "@/lib/models/note";
import { collectionsInProject } from "@/lib/projects/project-match";
import { useSelectedProjectId } from "@/lib/projects/use-project-filter";
import {
  notesInProjectNotebooks,
  notesViewOutsideProject,
  projectCreateNotebook,
} from "@/notes-core/src/notes-project-scope";
import type { NotesShellState } from "@/notes-core/src/use-notes-shell";

/**
 * The Project filter in Notes (#818 C3): the one place that narrows notebooks.
 * The sidebar gets the Project's notebooks; the note list hides every other notebook
 * through the hidden-notebook set it already honors, so both always agree.
 */
export function useNotesProjectScope(shell: NotesShellState) {
  const selectedProjectId = useSelectedProjectId();
  const { notebookCollections, hiddenNotebookIds, view, setView } = shell;

  const projectNotebooks = useMemo(
    () =>
      selectedProjectId === null
        ? null
        : collectionsInProject(notebookCollections, selectedProjectId),
    [notebookCollections, selectedProjectId],
  );

  const listHiddenNotebookIds = useMemo(() => {
    if (projectNotebooks === null) return hiddenNotebookIds;
    const insideIds = new Set(projectNotebooks.map((notebook) => notebook.id));
    const insideNames = new Set(projectNotebooks.map((notebook) => notebook.name));
    const hidden = new Set(hiddenNotebookIds);
    for (const notebook of notebookCollections) {
      if (insideIds.has(notebook.id)) continue;
      hidden.add(notebook.id);
      // Name keys catch notes without a notebook id; never hide a Project name.
      if (!insideNames.has(notebook.name)) hidden.add(notebook.name);
    }
    return hidden;
  }, [hiddenNotebookIds, notebookCollections, projectNotebooks]);

  // A notebook outside the Project is open: go to the Project's notebook instead.
  useEffect(() => {
    const next = notesViewOutsideProject(view, notebookCollections, projectNotebooks);
    if (next !== null && next !== view) setView(next);
  }, [notebookCollections, projectNotebooks, setView, view]);

  const projectSelected = projectNotebooks !== null;
  return {
    projectSelected,
    projectNotebooks,
    listShell: { ...shell, hiddenNotebookIds: listHiddenNotebookIds },
    /** New notes need a writable Project notebook outside a notebook view. */
    canCreateNote:
      shell.canCreateNote &&
      (!projectSelected ||
        view.startsWith("nb:") ||
        projectCreateNotebook(projectNotebooks) !== null),
  };
}

/** Close the open note when the selected Project does not hold it. */
export function useCloseNoteOutsideProject(
  active: Note | undefined,
  projectNotebooks: Parameters<typeof notesInProjectNotebooks>[1],
  closeNote: () => void,
): void {
  useEffect(() => {
    if (!active || projectNotebooks === null) return;
    if (notesInProjectNotebooks([active], projectNotebooks).length === 0) closeNote();
  }, [active, closeNote, projectNotebooks]);
}
