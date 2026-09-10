import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "button.css"), "utf8");

describe("button outline chrome", () => {
  it("defaults outline borders to Select/Input --control-border-color", () => {
    expect(css).toMatch(
      /\.button--variant-outline \{[\s\S]*border:\s*1px solid var\(--button-outline-border-color,\s*var\(--control-border-color\)\)/,
    );
    expect(css).toMatch(/\.button--variant-outline \{[\s\S]*background-color:\s*transparent/);
  });

  it("tints outline hover color via --button-outline-hover-color with outline/ink fallback", () => {
    expect(css).toMatch(
      /\.button--variant-outline:hover \{[\s\S]*color:\s*var\(\s*--button-outline-hover-color,\s*var\(--button-outline-color,\s*var\(--color-ink\)\)\s*\)/,
    );
    expect(css).toMatch(
      /\.button--variant-outline:hover \{[\s\S]*background-color:\s*var\(\s*--button-outline-hover-background/,
    );
  });
});
