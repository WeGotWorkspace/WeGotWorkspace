/**
 * Install-icon sources must be full-bleed squares. A rounded tile with transparent
 * corners flattens those corners to the wrong color, and sampling pixel (0,0)
 * then pads the maskable icon with that color.
 *
 * Meet's viewBox is 1px taller than its background rect (`270` vs `271`). One pixel
 * of slack keeps that file valid without accepting a small inset tile.
 */

const FULL_BLEED_SLACK = 1;

function attrNumber(attrs, name) {
  const match = attrs.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]+)"`, "i"));
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
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

  const covers = [...markup.matchAll(/<rect\b([^>]*)>/gi)].some((match) => {
    const attrs = match[1];
    if (/\brx\s*=/i.test(attrs) || /\bry\s*=/i.test(attrs)) return false;
    const width = attrNumber(attrs, "width");
    const height = attrNumber(attrs, "height");
    const x = attrNumber(attrs, "x") ?? 0;
    const y = attrNumber(attrs, "y") ?? 0;
    if (width == null || height == null) return false;
    return (
      Math.abs(x) <= FULL_BLEED_SLACK &&
      Math.abs(y) <= FULL_BLEED_SLACK &&
      Math.abs(width - viewBoxWidth) <= FULL_BLEED_SLACK &&
      Math.abs(height - viewBoxHeight) <= FULL_BLEED_SLACK
    );
  });

  if (!covers) {
    throw new Error(
      `${app}: SVG is not a full-bleed square — a background rect must cover the viewBox`,
    );
  }
}
