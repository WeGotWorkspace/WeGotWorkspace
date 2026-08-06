/** Subset of drive `myRights` that Notes collab UI enforces. */
export type NotesCollabShareRights = {
  mayEditContent: boolean;
};

/**
 * Whether the note body TipTap surface should accept typing.
 *
 * Notes has no comment/full ACL tiers (view | edit only) — view means
 * read-only body + no metadata mutations in the UI.
 *
 * - `undefined`/`null` rights and not loading → editable (Storybook / no share fetch)
 * - explicit rights → `mayEditContent`
 * - loading with unknown rights → locked (never flash view-only as editable)
 */
export function resolveNotesEditorEditable(
  rights: NotesCollabShareRights | null | undefined,
  loading = false,
): boolean {
  if (rights != null) return rights.mayEditContent === true;
  if (loading) return false;
  return true;
}
