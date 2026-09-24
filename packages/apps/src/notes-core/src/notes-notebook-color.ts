/** Matches provisioned General (`CalendarColorPalette::NOTE_GENERAL`). */
export const DEFAULT_NOTEBOOK_COLOR = "#14b8a6";

/** Same hexes as `--color-we-got-dark` / `--color-we-got-soft` (We Got Dark / Soft). */
export const NOTES_INK_HEX = "#003311";
export const NOTES_CREAM_HEX = "#fff5e9";

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
 * WCAG contrast pick for a mark on a full-strength notebook fill
 * (checked task-list boxes). Title/body use `--notes-detail-contrast-fg`
 * from workspace CSS (ink mixed onto the light sheet).
 */
export function notebookContrastFg(background: string): string {
  if (!/^#[0-9A-F]{6}$/i.test(background.trim())) return "var(--color-we-got-dark)";
  const ink = contrastRatio(background, NOTES_INK_HEX);
  const cream = contrastRatio(background, NOTES_CREAM_HEX);
  return cream > ink ? "var(--color-we-got-soft)" : "var(--color-we-got-dark)";
}

export type NotesDetailTintStyle = {
  ["--notes-detail-tint"]: string;
  ["--notes-detail-check-fg"]: string;
};

/** Inline vars for a single open note — live notebook hex + check-mark contrast. */
export function notesDetailTintStyle(tint: string | undefined): NotesDetailTintStyle | undefined {
  if (!tint) return undefined;
  return {
    ["--notes-detail-tint"]: notebookTintForCascade(tint),
    // Checkmark sits on a full-accent checkbox, so pick ink vs cream from the hex.
    ["--notes-detail-check-fg"]: notebookContrastFg(tint),
  };
}
