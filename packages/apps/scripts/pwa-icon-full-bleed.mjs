/**
 * Install-icon sources must be full-bleed squares. A rounded tile with transparent
 * corners flattens those corners to the wrong color.
 *
 * Returns the fill of the rect that covers the viewBox. After
 * `svgForRasterization`, that fill is the maskable pad color. Do not sample a
 * PNG pixel: a header band or glyph on the top edge is not the tile background.
 *
 * The viewBox itself must be square. A fraction of a pixel of slack only absorbs
 * export rounding on the background rect, not a 61px-tall viewBox.
 */

const FULL_BLEED_SLACK = 0.05;

function attrNumber(attrs, name) {
  const raw = attrString(attrs, name);
  if (raw == null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function attrString(attrs, name) {
  const match = attrs.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i"));
  return match ? match[1] : null;
}

export function assertFullBleedSquare(app, markup) {
  const viewBox = markup.match(/viewBox\s*=\s*"([^"]+)"/i);
  if (!viewBox) {
    throw new Error(`${app}: SVG has no viewBox`);
  }
  const parts = viewBox[1]
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (parts.length !== 4 || parts.some((value) => !Number.isFinite(value))) {
    throw new Error(`${app}: SVG viewBox is not four numbers`);
  }
  const [, , viewBoxWidth, viewBoxHeight] = parts;
  if (Math.abs(viewBoxWidth - viewBoxHeight) > FULL_BLEED_SLACK) {
    throw new Error(`${app}: viewBox is not square (${viewBoxWidth}x${viewBoxHeight})`);
  }

  let fill = null;
  for (const match of markup.matchAll(/<rect\b([^>]*)>/gi)) {
    const attrs = match[1];
    if (/\brx\s*=/i.test(attrs) || /\bry\s*=/i.test(attrs)) continue;
    const width = attrNumber(attrs, "width");
    const height = attrNumber(attrs, "height");
    const x = attrNumber(attrs, "x") ?? 0;
    const y = attrNumber(attrs, "y") ?? 0;
    if (width == null || height == null) continue;
    const covers =
      Math.abs(x) <= FULL_BLEED_SLACK &&
      Math.abs(y) <= FULL_BLEED_SLACK &&
      Math.abs(width - viewBoxWidth) <= FULL_BLEED_SLACK &&
      Math.abs(height - viewBoxHeight) <= FULL_BLEED_SLACK;
    if (!covers) continue;
    fill = attrString(attrs, "fill");
    break;
  }

  if (fill == null || fill === "") {
    throw new Error(
      `${app}: SVG is not a full-bleed square — a background rect must cover the viewBox`,
    );
  }

  return fill;
}
