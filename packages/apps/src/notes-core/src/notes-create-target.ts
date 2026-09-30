import { preferredCollectionName } from "@/lib/default-collection-prefs";
import { parseGroupNotebookPath } from "@/notes-core/src/notes-note-utils";

export type NotesCreateTarget = {
  notebook: string;
  scope?: "group";
  groupSlug?: string;
};

/** Resolve notebook (+ optional group scope) for a new note from the active view. */
export function resolveNotesCreateTarget(
  view: string,
  personalNotebooks: string[],
): NotesCreateTarget {
  if (view.startsWith("shared-nb:")) {
    const parsed = parseGroupNotebookPath(view.slice("shared-nb:".length));
    if (parsed) {
      return {
        notebook: parsed.notebook,
        scope: "group",
        groupSlug: parsed.groupSlug,
      };
    }
  }
  if (view.startsWith("nb:")) {
    return { notebook: view.slice(3) };
  }
  return {
    notebook:
      preferredCollectionName("notes", personalNotebooks) ?? personalNotebooks[0] ?? "Drafts",
  };
}
