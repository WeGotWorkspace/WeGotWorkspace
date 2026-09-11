import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "paper-sheet.css"), "utf8");
const styles = readFileSync(join(here, "../styles.css"), "utf8");

describe("paper-sheet shared surface", () => {
  it("paints fill and elevation from shared tokens with square corners", () => {
    expect(styles).toMatch(/--paper-sheet-bg:\s*oklch\(1 0 0\)/);
    expect(styles).toMatch(/--sheet-shadow:\s*0 1px 2px #0000000a,\s*0 10px 30px -10px #0f172a1f/);
    expect(css).toMatch(/\.paper-sheet \{[\s\S]*background-color:\s*var\(--paper-sheet-bg\)/);
    expect(css).toMatch(
      /\.paper-sheet \{[\s\S]*box-shadow:\s*var\(--paper-sheet-shadow,\s*var\(--sheet-shadow\)\)/,
    );
    expect(css).toMatch(/\.paper-sheet \{[\s\S]*border-radius:\s*0/);
  });

  it("grows with content and fills a parent-published scrollport floor", () => {
    expect(css).toMatch(/\.paper-sheet \{[\s\S]*height:\s*fit-content/);
    expect(css).toMatch(
      /\.paper-sheet \{[\s\S]*min-height:\s*var\(--paper-sheet-min-height,\s*auto\)/,
    );
  });
});
