/**
 * What the Notes detail pane shows for the list's selection and the open note.
 *
 * - `empty`: no single selection, or no open note. Covers cmd/ctrl-deselect and a
 *   view's selection reset, which clear the selection but leave a stale open id.
 * - `open`: the selected row is the open note.
 * - `opening`: one row is selected but another note is still open. A click selects
 *   the row at once and opens the note in a transition, so for a render the two
 *   differ. The open note stays up (no flash of the empty state) but takes no
 *   input: a keystroke in that window would land in the note the user just left.
 */
export type NoteDetailMode = "empty" | "open" | "opening";

export function noteDetailMode(
  selectedIds: readonly string[],
  openNoteId: string | null | undefined,
): NoteDetailMode {
  if (selectedIds.length !== 1 || !openNoteId) return "empty";
  return selectedIds[0] === openNoteId ? "open" : "opening";
}
