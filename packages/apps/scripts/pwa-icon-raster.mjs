/**
 * librsvg does not resolve CSS custom properties. Peel `var(--token, fallback)`
 * from the inside out so a nested brand token collapses to its hex fallback:
 * `var(--app-icon-layer-surface, var(--color-we-got-yellow, #ffc800))` → `#ffc800`.
 */
export function svgForRasterization(markup) {
  const pattern = /var\(\s*--[\w-]+\s*,\s*([^()]+?)\s*\)/g;
  let current = markup;
  for (let pass = 0; pass < 8; pass += 1) {
    const next = current.replace(pattern, "$1");
    if (next === current) return current;
    current = next;
  }
  throw new Error("CSS var() in icon SVG did not resolve to a color");
}

/**
 * Browser tabs show a favicon as drawn; they do not round it like a launcher.
 * Clip the full-bleed artwork to the in-app tile radius (1/6 of the side, see
 * `.workspace-app-icon--tile`). Fills keep their brand tokens; an external
 * image resolves them to the hex fallbacks.
 */
export function roundedFaviconSvg(markup) {
  const open = markup.match(/<svg\b[^>]*>/i);
  const viewBox = open?.[0].match(/viewBox\s*=\s*"([^"]+)"/i);
  if (!open || !viewBox) throw new Error("Favicon SVG has no <svg viewBox>");
  const [x, y, width, height] = viewBox[1]
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const radius = Math.round((Math.min(width, height) / 6) * 1000) / 1000;
  const position = `${x ? ` x="${x}"` : ""}${y ? ` y="${y}"` : ""}`;
  const clip =
    `<clipPath id="favicon-tile"><rect width="${width}" height="${height}"${position} rx="${radius}"/></clipPath>\n` +
    `<g clip-path="url(#favicon-tile)">`;
  const body = markup
    .slice(open.index + open[0].length)
    .replace(/<\/svg>\s*$/i, "")
    .trim();
  return `${open[0]}\n${clip}\n${body}\n</g>\n</svg>\n`;
}
