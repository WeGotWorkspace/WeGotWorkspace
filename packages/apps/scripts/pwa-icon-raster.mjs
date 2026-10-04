/**
 * librsvg does not resolve CSS custom properties. Peel `var(--token, fallback)`
 * from the inside out so a nested brand token collapses to its hex fallback:
 * `var(--workspace-brand, var(--color-we-got-yellow, #ffc800))` → `#ffc800`.
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
