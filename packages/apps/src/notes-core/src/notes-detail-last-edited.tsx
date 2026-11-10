import "@/notes-core/src/notes-detail-last-edited.css";

type NotesDetailLastEditedProps = {
  /** Formatted last-edited date (`formatNoteLastEdited`); nothing renders when empty. */
  lastEdited: string;
  /** Visible prefix before the date ("Edited"). */
  editedLabel: string;
};

/**
 * Last-edited date beside the notebook switcher above the note title: plain text
 * ("Edited 17:42") after a quiet `|`, not a chip.
 */
export function NotesDetailLastEdited({ lastEdited, editedLabel }: NotesDetailLastEditedProps) {
  if (!lastEdited || lastEdited === "—") return null;
  return (
    <span className="notes-detail-last-edited">
      <span className="notes-detail-last-edited__separator" aria-hidden="true">
        |
      </span>
      <span className="notes-detail-last-edited__date">
        {editedLabel} {lastEdited}
      </span>
    </span>
  );
}
