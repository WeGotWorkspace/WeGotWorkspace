import { preferredCollectionName } from "@/lib/default-collection-prefs";
import { parseGroupNotebookPath } from "@/notes-core/src/notes-note-utils";
import { findNotebookCollection } from "@/notes-core/src/notes-notebook-write";
import type { NotesNotebookCollection } from "@/notes-core/src/notes-types";

export type NotesCreateTarget = {
  /** Display name — still sent for the legacy name-keyed fallback. */
  notebook: string;
  /** REST collection id. Set for every `nb:` view; absent only for the name-keyed fallback. */
  notebookId?: string;
  scope?: "group";
  groupSlug?: string;
};

/** Resolve notebook (+ optional group scope) for a new note from the active view. */
export function resolveNotesCreateTarget(
  view: string,
  personalNotebooks: string[],
  notebookCollections: readonly NotesNotebookCollection[] = [],
): NotesCreateTarget {
  if (view.startsWith("shared-nb:")) {
    const parsed = parseGroupNotebookPath(view.slice("shared-nb:".length));
    if (parsed) {
      return { notebook: parsed.notebook, scope: "group", groupSlug: parsed.groupSlug };
    }
  }
  if (view.startsWith("nb:")) {
    // The view key is usually the REST collection id. Name keys still occur:
    // a move builds `nb:${id || name}`, and the workspace still matches `nb:${name}`.
    const key = view.slice(3);
    const collection = findNotebookCollection(notebookCollections, key);
    if (collection) {
      const groupSlug = collection.scope === "group" ? collection.groupSlug?.trim() : undefined;
      return {
        notebook: collection.name,
        notebookId: collection.id,
        ...(groupSlug ? { scope: "group" as const, groupSlug } : {}),
      };
    }
    return { notebook: key };
  }
  return {
    notebook:
      preferredCollectionName("notes", personalNotebooks) ?? personalNotebooks[0] ?? "Drafts",
  };
}
