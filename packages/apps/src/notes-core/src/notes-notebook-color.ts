/** Matches provisioned General (`CalendarColorPalette::NOTE_GENERAL`). */
export const DEFAULT_NOTEBOOK_COLOR = "#14b8a6";

/** Same hexes as `--color-ink` / `--color-cream` in `styles.css`. */
export const NOTES_INK_HEX = "#042a22";
export const NOTES_CREAM_HEX = "#ffffff";

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

function hexChannel(value: number): number {
  const srgb = value / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!match) return 0;
  const r = hexChannel(Number.parseInt(match[1], 16));
  const g = hexChannel(Number.parseInt(match[2], 16));
  const b = hexChannel(Number.parseInt(match[3], 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(background: string, foreground: string): number {
  const left = relativeLuminance(background);
  const right = relativeLuminance(foreground);
  const lighter = Math.max(left, right);
  const darker = Math.min(left, right);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * WCAG contrast pick for text on a notebook-colored fill.
 * Returns the ink/cream CSS tokens (not gold).
 */
export function notebookContrastFg(background: string): string {
  if (!/^#[0-9A-F]{6}$/i.test(background.trim())) return "var(--color-ink)";
  const ink = contrastRatio(background, NOTES_INK_HEX);
  const cream = contrastRatio(background, NOTES_CREAM_HEX);
  return cream > ink ? "var(--color-cream)" : "var(--color-ink)";
}

/** Inline vars for a single open note — tint + contrast-safe chip/check mark. */
export function notesDetailTintStyle(
  tint: string | undefined,
): { ["--notes-detail-tint"]: string; ["--notes-detail-contrast-fg"]: string } | undefined {
  if (!tint) return undefined;
  return {
    ["--notes-detail-tint"]: tint,
    ["--notes-detail-contrast-fg"]: notebookContrastFg(tint),
  };
}
