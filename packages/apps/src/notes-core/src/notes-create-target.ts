import { preferredCollectionName } from "@/lib/default-collection-prefs";
import { projectIdOfFilter, readProjectFilter } from "@/lib/projects/project-filter";
import { collectionsInProject } from "@/lib/projects/project-match";
import { projectCreateNotebook } from "@/notes-core/src/notes-project-scope";
import { parseGroupNotebookPath } from "@/notes-core/src/notes-note-utils";
import { findNotebookCollection } from "@/notes-core/src/notes-notebook-write";
import type { NotesNotebookCollection } from "@/lib/models/notes-types";

export type NotesCreateTarget = {
  /** Display name — still sent for the legacy name-keyed fallback. */
  notebook: string;
  /** REST collection id. Set for every `nb:` view; absent only for the name-keyed fallback. */
  notebookId?: string;
  scope?: "group";
  groupSlug?: string;
};

function targetOfCollection(collection: NotesNotebookCollection): NotesCreateTarget {
  const groupSlug = collection.scope === "group" ? collection.groupSlug?.trim() : undefined;
  return {
    notebook: collection.name,
    notebookId: collection.id,
    ...(groupSlug ? { scope: "group" as const, groupSlug } : {}),
  };
}

/**
 * Resolve notebook (+ optional group scope) for a new note from the active view.
 * Outside a notebook view, the selected Project's notebook wins over the default
 * (#818). `projectId` defaults to the stored Project filter; a stale id matches none.
 */
export function resolveNotesCreateTarget(
  view: string,
  personalNotebooks: string[],
  notebookCollections: readonly NotesNotebookCollection[] = [],
  projectId: string | null = projectIdOfFilter(readProjectFilter()),
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
    if (collection) return targetOfCollection(collection);
    return { notebook: key };
  }
  const projectNotebook =
    projectId === null
      ? null
      : projectCreateNotebook(collectionsInProject(notebookCollections, projectId));
  if (projectNotebook) return targetOfCollection(projectNotebook);
  return {
    notebook:
      preferredCollectionName("notes", personalNotebooks) ?? personalNotebooks[0] ?? "Drafts",
  };
}
