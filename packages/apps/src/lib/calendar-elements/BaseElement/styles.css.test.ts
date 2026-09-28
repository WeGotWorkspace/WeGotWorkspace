import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { stripLayerBlocks } from "./strip-layer-blocks";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "styles.css"), "utf8");
const hostFontCss = readFileSync(join(here, "../styles/host-font.css"), "utf8");

describe("calendar BaseElement surface CSS", () => {
  it("defaults --_lc-surface-bg to cream paper, never pure white", () => {
    expect(css).toMatch(
      /--_lc-surface-bg:\s*var\(\s*--_lc-app-header-bg-color,\s*var\(\s*--lg-background-color,\s*var\(--workspace-surface,\s*light-dark\(var\(--color-we-got-soft\),\s*#222\)\)\s*\)\s*\)/,
    );
    expect(css).not.toMatch(/--_lc-surface-bg:[^;]*light-dark\(\s*#fff\b/);
    expect(css).not.toMatch(/--_lc-surface-bg:[^;]*#fff(?:fff)?\b/i);
  });

  it("imports host-font.css for the unlayered product sans pin", () => {
    expect(css).toMatch(/@import\s+["'][^"']*host-font\.css["']/);
    const unlayered = stripLayerBlocks(hostFontCss);
    expect(unlayered).toMatch(/:host\s*\{[^}]*--font-sans:\s*var\(--font-we-got-sans\)/);
    expect(unlayered).toMatch(/:host\s*\{[^}]*font-family:\s*var\(--font-sans\)/);
  });
});
