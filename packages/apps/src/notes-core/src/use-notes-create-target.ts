import { useCallback } from "react";
import { collectionsInProject } from "@/lib/projects/project-match";
import { useSelectedProjectIds } from "@/lib/projects/use-project-filter";
import type { NotesNotebookCollection } from "@/lib/models/notes-types";
import { resolveNotesCreateTarget } from "./notes-create-target";

/**
 * Where a new note goes for a view: the notebook of the view, or the one the Project or
 * Team filter shows (the same set the sidebar and list use) before the default.
 */
export function useNotesCreateTarget(
  notebooks: string[],
  notebookCollections: readonly NotesNotebookCollection[],
) {
  const selectedProjectIds = useSelectedProjectIds();
  return useCallback(
    (view: string) =>
      resolveNotesCreateTarget(
        view,
        notebooks,
        notebookCollections,
        selectedProjectIds === null
          ? null
          : collectionsInProject(notebookCollections, selectedProjectIds),
      ),
    [notebooks, notebookCollections, selectedProjectIds],
  );
}
