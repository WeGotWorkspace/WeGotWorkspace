/** Fallback when `--text-editor-prose-font-size` is absent (matches clamp max). */
export const TEXT_EDITOR_PROSE_FONT_SIZE_FALLBACK = "16px";

let fontSizeProbe: HTMLDivElement | null = null;

/** Convert a concrete CSS length token to px (@96dpi / root rem). */
function cssLengthToPx(length: string, rootFontSizePx = 16): number {
  const value = length.trim();
  const match = value.match(/^(-?[\d.]+)([a-z%]*)$/i);
  if (!match) return 0;

  const amount = Number.parseFloat(match[1]);
  const unit = match[2].toLowerCase();

  switch (unit) {
    case "px":
      return amount;
    case "in":
      return amount * 96;
    case "rem":
      return amount * rootFontSizePx;
    case "em":
      return amount * rootFontSizePx;
    case "pt":
      return amount * (96 / 72);
    case "cm":
      return amount * (96 / 2.54);
    case "mm":
      return amount * (96 / 25.4);
    default:
      return amount;
  }
}

/**
 * Resolve `--text-editor-prose-font-size` on `scope` (or `:root`) to px for layout
 * maths. Print typography derives from the same CSS token.
 */
export function resolveTextEditorProseFontSizePx(scope: Element | null = null): number {
  const host = scope ?? document.documentElement;
  const token =
    getComputedStyle(host).getPropertyValue("--text-editor-prose-font-size").trim() ||
    TEXT_EDITOR_PROSE_FONT_SIZE_FALLBACK;

  if (!fontSizeProbe) {
    fontSizeProbe = document.createElement("div");
    fontSizeProbe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none";
    document.documentElement.appendChild(fontSizeProbe);
  }

  fontSizeProbe.style.fontSize = token;
  const computed = getComputedStyle(fontSizeProbe).fontSize;
  fontSizeProbe.style.fontSize = "";

  if (computed.endsWith("px")) {
    return Number.parseFloat(computed);
  }

  const rootFontSizePx =
    Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  return cssLengthToPx(token, rootFontSizePx);
}

/** Read the raw `--text-editor-prose-font-size` token for print typography sync. */
export function readTextEditorProseFontSizeToken(scope: Element | null = null): string {
  const host = scope ?? document.documentElement;
  return (
    getComputedStyle(host).getPropertyValue("--text-editor-prose-font-size").trim() ||
    TEXT_EDITOR_PROSE_FONT_SIZE_FALLBACK
  );
}
