/** Matches provisioned General (`CalendarColorPalette::NOTE_GENERAL`). */
export const DEFAULT_NOTEBOOK_COLOR = "#14b8a6";

/**
 * Calendar event-card light wash (`surfaceTint(color, 11)` in srgb).
 * Notes detail uses the same percentage in oklab on cream.
 */
export const NOTES_DETAIL_TINT_PERCENT = 11;

export function notebookDotColor(notebook?: { color?: string | null } | null): string {
  const color = notebook?.color?.trim();
  return color || DEFAULT_NOTEBOOK_COLOR;
}

/**
 * Live collection color for a note — same id-then-name lookup as
 * `notebookDisplayName`. Missing collection → `undefined` (no tint).
 */
export function notebookDisplayColor(
  note: { notebook?: string; notebookId?: string | null },
  collections: readonly { id: string; name: string; color?: string | null }[] = [],
): string | undefined {
  if (note.notebookId) {
    const byId = collections.find((item) => item.id === note.notebookId);
    if (byId) return notebookDotColor(byId);
  }
  const byName = collections.find((item) => item.name === note.notebook);
  return byName ? notebookDotColor(byName) : undefined;
}
