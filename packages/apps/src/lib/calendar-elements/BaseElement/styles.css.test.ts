import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "styles.css"), "utf8");

describe("calendar BaseElement surface CSS", () => {
  it("defaults --_lc-surface-bg to cream paper, never pure white", () => {
    expect(css).toMatch(
      /--_lc-surface-bg:\s*var\(\s*--_lc-app-header-bg-color,\s*var\(--lg-background-color,\s*light-dark\(var\(--color-cream,\s*#fff5e9\),\s*#222\)\)/,
    );
    expect(css).not.toMatch(/--_lc-surface-bg:[^;]*light-dark\(\s*#fff\b/);
    expect(css).not.toMatch(/--_lc-surface-bg:[^;]*#fff(?:fff)?\b/i);
  });
});
