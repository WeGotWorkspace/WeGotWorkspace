import type { Note } from "@/lib/models/note";
import type { NotesUILabels } from "@/notes-core/src/notes-labels";
import { NotebookSelect, type NotebookSelectItem } from "@/project-dialog/src/notebook-select";
import { notebookDisplayName } from "@/notes-core/src/notes-note-utils";
import { notebookDisplayColor } from "@/lib/models/notebook-color";

type NotesDetailNotebookSelectProps = {
  active: Note;
  labels: NotesUILabels;
  archived: Record<string, boolean>;
  notebooks: NotebookSelectItem[];
  onMoveToNotebook: (notebook: NotebookSelectItem) => void;
  onCreateNotebook?: () => void;
  /** Notebook `calendarcolor` (same colour as the list dot and the sidebar). */
  notebookColor?: string | null;
  /** View-only share: the note cannot move. */
  readOnly?: boolean;
};

/**
 * The open note's notebook, above its title: the name in the notebook colour as a
 * ghost dropdown that moves the note.
 */
export function NotesDetailNotebookSelect({
  active,
  labels,
  archived,
  notebooks,
  onMoveToNotebook,
  onCreateNotebook,
  notebookColor,
  readOnly = false,
}: NotesDetailNotebookSelectProps) {
  const sharedInbox = !!active.sharedInbox;
  // Writable group notebooks are My notebooks — same move as personal.
  // Lock inbound Shared-with-me leftovers, view-only shares, and archived
  // notes, which do not move until they are restored (#1535).
  const locked = sharedInbox || readOnly || !!archived[active.id];
  // Personal shares: the grantor username stays on the list row; here the
  // notebook / Shared with me shows. Group notebooks use the collection
  // display name (same as the sidebar), never the group-… slug.
  const name = sharedInbox
    ? active.notebook.trim() || labels.sidebarSharedWithMe
    : notebookDisplayName(active, notebooks).trim() || labels.toolbarMoveToNotebook;

  return (
    <NotebookSelect
      notebooks={notebooks}
      value={{
        id: active.notebookId,
        name,
        color: notebookColor ?? notebookDisplayColor(active, notebooks),
      }}
      labels={labels}
      triggerVariant="ghost"
      disabled={locked}
      onNotebookChange={onMoveToNotebook}
      onCreateNotebook={locked ? undefined : onCreateNotebook}
    />
  );
}
