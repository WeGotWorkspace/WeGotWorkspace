/**
 * Paper sizes for the paginated Docs view and print. A person's choice, never stored
 * in the document (#1810). Sizes are CSS px at 96 dpi, the unit print and layout share.
 */
export const TEXT_EDITOR_PAGE_FORMATS = ["a4", "a3", "a5", "letter", "legal"] as const;
export const TEXT_EDITOR_PAGE_ORIENTATIONS = ["portrait", "landscape"] as const;
export const TEXT_EDITOR_PAGE_LAYOUTS = ["pages", "continuous"] as const;

export type TextEditorPageFormat = (typeof TEXT_EDITOR_PAGE_FORMATS)[number];
export type TextEditorPageOrientation = (typeof TEXT_EDITOR_PAGE_ORIENTATIONS)[number];
/** `pages` shows separate sheets on screen; `continuous` shows one long sheet. */
export type TextEditorPageLayout = (typeof TEXT_EDITOR_PAGE_LAYOUTS)[number];

export type TextEditorPageSetup = {
  format: TextEditorPageFormat;
  orientation: TextEditorPageOrientation;
  layout: TextEditorPageLayout;
};

type PageFormatSpec = {
  label: string;
  /** Portrait width and height in CSS px (96 dpi). */
  width: number;
  height: number;
  /** `@page size` keyword. */
  cssSize: string;
};

const MM = 96 / 25.4;

export const TEXT_EDITOR_PAGE_FORMAT_SPECS: Record<TextEditorPageFormat, PageFormatSpec> = {
  a4: { label: "A4", width: Math.round(210 * MM), height: Math.round(297 * MM), cssSize: "A4" },
  a3: { label: "A3", width: Math.round(297 * MM), height: Math.round(420 * MM), cssSize: "A3" },
  a5: { label: "A5", width: Math.round(148 * MM), height: Math.round(210 * MM), cssSize: "A5" },
  letter: { label: "Letter", width: 816, height: 1056, cssSize: "letter" },
  legal: { label: "Legal", width: 816, height: 1344, cssSize: "legal" },
};

/** Fixed "normal" margin on every side: 1 inch (2.54 cm), on screen and in print. */
export const TEXT_EDITOR_PAGE_MARGIN_PX = 96;
export const TEXT_EDITOR_PAGE_MARGIN_CSS = "1in";

export type TextEditorPageBox = {
  width: number;
  height: number;
  margin: number;
};

export function textEditorPageBox(
  setup: Pick<TextEditorPageSetup, "format" | "orientation">,
): TextEditorPageBox {
  const spec = TEXT_EDITOR_PAGE_FORMAT_SPECS[setup.format];
  const landscape = setup.orientation === "landscape";
  return {
    width: landscape ? spec.height : spec.width,
    height: landscape ? spec.width : spec.height,
    margin: TEXT_EDITOR_PAGE_MARGIN_PX,
  };
}

/** `@page` rule for print: paper size, orientation and the fixed margin. */
export function textEditorPageCssRule(
  setup: Pick<TextEditorPageSetup, "format" | "orientation">,
): string {
  const size = `${TEXT_EDITOR_PAGE_FORMAT_SPECS[setup.format].cssSize} ${setup.orientation}`;
  return `@page { size: ${size}; margin: ${TEXT_EDITOR_PAGE_MARGIN_CSS} !important; }`;
}

/** Regions that use US Letter: the United States and Canada (#1810). */
const LETTER_REGIONS = new Set(["US", "CA"]);

function localeRegion(locale: string): string | null {
  try {
    const parsed = new Intl.Locale(locale);
    return parsed.region ?? parsed.maximize().region ?? null;
  } catch {
    return null;
  }
}

/** Letter for a US or Canada locale, A4 everywhere else (and when the locale is unknown). */
export function defaultTextEditorPageFormat(locales: readonly string[]): TextEditorPageFormat {
  const first = locales.find((locale) => locale.trim().length > 0);
  if (!first) return "a4";
  const region = localeRegion(first);
  return region && LETTER_REGIONS.has(region) ? "letter" : "a4";
}

export function isTextEditorPageFormat(value: unknown): value is TextEditorPageFormat {
  return (TEXT_EDITOR_PAGE_FORMATS as readonly unknown[]).includes(value);
}

export function isTextEditorPageOrientation(value: unknown): value is TextEditorPageOrientation {
  return (TEXT_EDITOR_PAGE_ORIENTATIONS as readonly unknown[]).includes(value);
}

export function isTextEditorPageLayout(value: unknown): value is TextEditorPageLayout {
  return (TEXT_EDITOR_PAGE_LAYOUTS as readonly unknown[]).includes(value);
}
