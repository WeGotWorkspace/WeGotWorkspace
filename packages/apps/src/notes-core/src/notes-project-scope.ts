import type { Note } from "@/lib/models/note";
import type { NotesNotebookCollection } from "@/lib/models/notes-types";
import { canCreateInNotebook } from "@/notes-core/src/notes-notebook-write";

/**
 * The Project filter in Notes (#818 C3). `projectNotebooks` is null for "All Projects"
 * and the selected Project's notebooks otherwise.
 */

/** Notes in the given notebooks; every note when the filter shows all Projects. */
export function notesInProjectNotebooks(
  notes: Note[],
  projectNotebooks: readonly Pick<NotesNotebookCollection, "id" | "name">[] | null,
): Note[] {
  if (projectNotebooks === null) return notes;
  const keys = new Set(projectNotebooks.flatMap((notebook) => [notebook.id, notebook.name]));
  return notes.filter((note) =>
    note.notebookId ? keys.has(note.notebookId) : keys.has(note.notebook),
  );
}

/** Where a new note goes while a Project is selected: its first writable notebook. */
export function projectCreateNotebook(
  projectNotebooks: readonly NotesNotebookCollection[] | null,
): NotesNotebookCollection | null {
  if (projectNotebooks === null) return null;
  return projectNotebooks.find((notebook) => canCreateInNotebook(notebook)) ?? null;
}

/**
 * The view to go to when the open one shows a notebook outside the selected Project:
 * the Project's notebook, else All. Null keeps the view (no Project, a smart view,
 * or a notebook not loaded yet).
 */
export function notesViewOutsideProject(
  view: string,
  notebookCollections: readonly Pick<NotesNotebookCollection, "id" | "name">[],
  projectNotebooks: readonly Pick<NotesNotebookCollection, "id" | "name">[] | null,
): string | null {
  if (projectNotebooks === null) return null;
  if (view.startsWith("shared-nb:")) return "all";
  if (!view.startsWith("nb:")) return null;
  const key = view.slice(3);
  const matches = (item: { id: string; name: string }) => item.id === key || item.name === key;
  if (projectNotebooks.some(matches)) return null;
  if (!notebookCollections.some(matches)) return null;
  const first = projectNotebooks[0];
  return first ? `nb:${first.id}` : "all";
}
