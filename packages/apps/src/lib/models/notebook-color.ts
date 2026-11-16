/** Matches provisioned General (`CalendarColorPalette::NOTE_GENERAL`). */
export const DEFAULT_NOTEBOOK_COLOR = "#14b8a6";

/**
 * Calendar event-card light wash (`surfaceTint(color, 11)` in srgb).
 * Paper card (`--paper-sheet-bg`) uses the same percentage in **oklab**
 * on the workspace surface — a very light notebook tint that keeps
 * chroma/hue (oklch cylindrical mix into warm Soft reads peach). The
 * tint is published as `oklch(from #hex l c h)` so other oklch mixes
 * (tags, accent-strong) keep the notebook hue (a raw hex drops it).
 */
export const NOTES_DETAIL_TINT_PERCENT = 11;

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** Raw notebook hex → relative OKLCH so `color-mix(in oklch, …)` keeps the hue. */
export function notebookTintForCascade(tint: string): string {
  const trimmed = tint.trim();
  if (HEX_COLOR.test(trimmed)) return `oklch(from ${trimmed} l c h)`;
  return trimmed;
}

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
  if (byName) return notebookDotColor(byName);
  const byStoredId = collections.find((item) => item.id === note.notebook);
  return byStoredId ? notebookDotColor(byStoredId) : undefined;
}

export type NotesDetailTintStyle = {
  ["--notes-detail-tint"]: string;
};

/** Inline vars for a single open note — the live notebook hex. */
export function notesDetailTintStyle(tint: string | undefined): NotesDetailTintStyle | undefined {
  if (!tint) return undefined;
  return {
    ["--notes-detail-tint"]: notebookTintForCascade(tint),
  };
}
