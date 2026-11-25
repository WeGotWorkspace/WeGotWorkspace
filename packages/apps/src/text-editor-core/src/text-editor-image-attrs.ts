/**
 * Layout and caption of a Docs image, stored on the node. In markdown it stays standard:
 * `![alt](src#width=50&align=end "caption")`, the caption being the image title.
 */
/** Logical, so it follows the writing direction: `start` is the default (left in English). */
export const DOCS_IMAGE_ALIGNS = ["start", "center", "end"] as const;
export type DocsImageAlign = (typeof DOCS_IMAGE_ALIGNS)[number];

/** Width presets, as % of the text column. `null` keeps the picture's own size. */
export const DOCS_IMAGE_WIDTH_PRESETS = [25, 50, 75, 100] as const;
export const DOCS_IMAGE_MIN_WIDTH = 5;
export const DOCS_IMAGE_MAX_CAPTION_LENGTH = 500;

export type DocsImageLayoutAttrs = {
  width: number | null;
  align: DocsImageAlign | null;
  /** The caption under the picture. It is the image `title`, so markdown carries it as is. */
  title: string | null;
};

export function normalizeDocsImageWidth(value: unknown): number | null {
  const n = typeof value === "string" ? Number.parseFloat(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return Math.min(100, Math.max(DOCS_IMAGE_MIN_WIDTH, Math.round(n)));
}

/** Reads `left` / `right` (what this was briefly called) as `start` / `end`. */
const LEGACY_ALIGNS: Record<string, DocsImageAlign> = { left: "start", right: "end" };

export function normalizeDocsImageAlign(value: unknown): DocsImageAlign | null {
  if (typeof value !== "string") return null;
  return DOCS_IMAGE_ALIGNS.find((align) => align === value) ?? LEGACY_ALIGNS[value] ?? null;
}

export function normalizeDocsImageCaption(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim().slice(0, DOCS_IMAGE_MAX_CAPTION_LENGTH);
  return text || null;
}

export function isDocsImageWidthPreset(width: number | null): boolean {
  return width != null && (DOCS_IMAGE_WIDTH_PRESETS as readonly number[]).includes(width);
}

/** Links on an image: web and mail only. */
export function normalizeDocsImageHref(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const href = value.trim();
  return /^(https?:\/\/|mailto:)/i.test(href) ? href : null;
}

/**
 * Fired on the image while a handle is dragged (`detail.width` in %), and with `null` once
 * the drag is over, so the image bar can show the size live instead of at pointer-up.
 */
export const DOCS_IMAGE_LIVE_WIDTH_EVENT = "docs-image-live-width";
export type DocsImageLiveWidthDetail = { width: number | null };
