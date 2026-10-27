/** Caret box in px, relative to the textarea's border box. */
export type TextareaCaretBox = { left: number; top: number; height: number };

/** One line of a selection in px, relative to the textarea's border box. */
export type TextareaSelectionBox = { left: number; top: number; width: number; height: number };

/** A range of the textarea value; `start` and `end` may come in either order. */
export type TextareaRange = { start: number; end: number };

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
  return withMirror(textarea, [], (mirror, style) => {
    const borderLeft = parseFloat(style.borderLeftWidth) || 0;
    const borderTop = parseFloat(style.borderTopWidth) || 0;
    const lineHeight = resolveLineHeight(style);
    return indexes.map((index) => {
      const marker = placeMarker(mirror, textarea.value, index);
      return {
        left: borderLeft + marker.offsetLeft - textarea.scrollLeft,
        top: borderTop + marker.offsetTop - textarea.scrollTop,
        height: lineHeight ?? marker.offsetHeight,
      };
    });
  });
}

/**
 * Pixel boxes for each range, one box per line the range covers. An empty
 * range has no boxes. Boxes are as tall as a line, so they line up with the
 * carets from {@link measureTextareaCarets}.
 */
export function measureTextareaSelections(
  textarea: HTMLTextAreaElement,
  ranges: readonly TextareaRange[],
): TextareaSelectionBox[][] {
  if (ranges.length === 0) return [];
  return withMirror(
    textarea,
    ranges.map(() => []),
    (mirror, style) => {
      const lineHeight = resolveLineHeight(style);
      return ranges.map((range) => {
        const span = placeSelection(mirror, textarea.value, range);
        if (!span) return [];
        const origin = mirror.getBoundingClientRect();
        const boxes: TextareaSelectionBox[] = [];
        for (const rect of span.getClientRects()) {
          // A wrap can leave an empty fragment at a line end.
          if (rect.width < 0.5) continue;
          boxes.push({
            left: rect.left - origin.left - textarea.scrollLeft,
            // Same top and height as a caret on this line.
            top: rect.top - origin.top - textarea.scrollTop,
            width: rect.width,
            height: lineHeight ?? rect.height,
          });
        }
        return boxes;
      });
    },
  );
}

/**
 * Runs `measure` against a hidden element that copies the textarea's computed
 * font, padding, width, and wrapping, then removes it.
 */
function withMirror<T>(
  textarea: HTMLTextAreaElement,
  fallback: T,
  measure: (mirror: HTMLElement, style: CSSStyleDeclaration) => T,
): T {
  const view = textarea.ownerDocument.defaultView;
  if (!view) return fallback;
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
  try {
    return measure(mirror, style);
  } finally {
    mirror.remove();
  }
}

/** Text before the range, the range in a span, then the rest, so wrapping matches. */
function placeSelection(
  mirror: HTMLElement,
  value: string,
  range: TextareaRange,
): HTMLElement | null {
  const clamp = (index: number) => Math.min(Math.max(0, index), value.length);
  const start = clamp(Math.min(range.start, range.end));
  const end = clamp(Math.max(range.start, range.end));
  if (start === end) return null;
  mirror.textContent = value.slice(0, start);
  const span = mirror.ownerDocument.createElement("span");
  span.textContent = value.slice(start, end);
  mirror.append(span, value.slice(end));
  return span;
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
