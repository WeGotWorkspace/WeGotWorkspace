/** Remove `@layer … { … }` blocks so layered-only rules cannot satisfy SSTs. */
export function stripLayerBlocks(css: string): string {
  let depth = 0;
  let unlayered = "";
  for (let i = 0; i < css.length; i++) {
    const slice = css.slice(i);
    if (depth === 0 && /^@layer\b/.test(slice)) {
      const brace = slice.indexOf("{");
      if (brace === -1) break;
      depth = 1;
      i += brace;
      continue;
    }
    if (depth > 0) {
      if (css[i] === "{") depth += 1;
      else if (css[i] === "}") depth -= 1;
      continue;
    }
    unlayered += css[i];
  }
  return unlayered;
}
