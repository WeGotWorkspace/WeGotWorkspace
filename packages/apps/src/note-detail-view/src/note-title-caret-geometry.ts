/** Caret box in px, relative to the textarea's border box. */
export type TextareaCaretBox = { left: number; top: number; height: number };

/** Computed properties that decide where text wraps and where a letter lands. */
const MIRRORED_PROPERTIES = [
  "box-sizing",
  "width",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "border-style",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "font-family",
  "font-size",
  "font-style",
  "font-variant",
  "font-weight",
  "font-stretch",
  "font-feature-settings",
  "font-kerning",
  "line-height",
  "letter-spacing",
  "word-spacing",
  "text-align",
  "text-indent",
  "text-transform",
  "tab-size",
  "white-space",
  "word-break",
  "overflow-wrap",
] as const;

/**
 * Pixel boxes for carets at `indexes` in a textarea. A hidden mirror element
 * copies the textarea's computed font, padding, width, and wrapping; the
 * result subtracts the textarea's scroll offset.
 */
export function measureTextareaCarets(
  textarea: HTMLTextAreaElement,
  indexes: readonly number[],
): TextareaCaretBox[] {
  if (indexes.length === 0) return [];
  const view = textarea.ownerDocument.defaultView;
  if (!view) return [];
  const style = view.getComputedStyle(textarea);
  const mirror = textarea.ownerDocument.createElement("div");
  for (const property of MIRRORED_PROPERTIES) {
    mirror.style.setProperty(property, style.getPropertyValue(property));
  }
  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.top = "0";
  mirror.style.left = "-9999px";
  mirror.style.overflow = "hidden";
  mirror.style.height = "auto";
  textarea.ownerDocument.body.append(mirror);

  const borderLeft = parseFloat(style.borderLeftWidth) || 0;
  const borderTop = parseFloat(style.borderTopWidth) || 0;
  const lineHeight = resolveLineHeight(style);
  try {
    return indexes.map((index) => {
      const marker = placeMarker(mirror, textarea.value, index);
      return {
        left: borderLeft + marker.offsetLeft - textarea.scrollLeft,
        top: borderTop + marker.offsetTop - textarea.scrollTop,
        height: lineHeight ?? marker.offsetHeight,
      };
    });
  } finally {
    mirror.remove();
  }
}

/** Text before the caret, then a marker holding the rest so wrapping matches. */
function placeMarker(mirror: HTMLElement, value: string, index: number): HTMLElement {
  const clamped = Math.min(Math.max(0, index), value.length);
  mirror.textContent = value.slice(0, clamped);
  const marker = mirror.ownerDocument.createElement("span");
  // A zero-width space keeps the marker on the line when the caret is at the end.
  marker.textContent = value.slice(clamped) || "​";
  mirror.append(marker);
  return marker;
}

function resolveLineHeight(style: CSSStyleDeclaration): number | null {
  const lineHeight = parseFloat(style.lineHeight);
  return Number.isFinite(lineHeight) ? lineHeight : null;
}
