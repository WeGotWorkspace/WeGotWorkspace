import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "styles.css"), "utf8");

describe("calendar BaseElement surface CSS", () => {
  it("defaults --_lc-surface-bg to cream paper, never pure white", () => {
    expect(css).toMatch(
      /--_lc-surface-bg:\s*var\(\s*--_lc-app-header-bg-color,\s*var\(\s*--lg-background-color,\s*var\(--workspace-surface,\s*light-dark\(var\(--color-we-got-soft\),\s*#222\)\)\s*\)\s*\)/,
    );
    expect(css).not.toMatch(/--_lc-surface-bg:[^;]*light-dark\(\s*#fff\b/);
    expect(css).not.toMatch(/--_lc-surface-bg:[^;]*#fff(?:fff)?\b/i);
  });

  it("restores --font-sans to product sans token on :host outside @layer (beats Tailwind theme)", () => {
    // Strip @layer blocks so a layered-only declaration cannot pass.
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
    expect(unlayered).toMatch(/:host\s*\{[^}]*--font-sans:\s*var\(--font-we-got-sans\)/);
    expect(unlayered).toMatch(/:host\s*\{[^}]*font-family:\s*var\(--font-sans\)/);
  });
});
