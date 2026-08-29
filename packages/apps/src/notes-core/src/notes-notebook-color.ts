/** Matches provisioned General (`CalendarColorPalette::NOTE_GENERAL`). */
export const DEFAULT_NOTEBOOK_COLOR = "#14b8a6";

export function notebookDotColor(notebook?: { color?: string | null } | null): string {
  const color = notebook?.color?.trim();
  return color || DEFAULT_NOTEBOOK_COLOR;
}
