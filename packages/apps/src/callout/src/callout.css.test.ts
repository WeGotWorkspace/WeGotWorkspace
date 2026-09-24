import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "callout.css"), "utf8");

describe("callout status token wiring", () => {
  it("points error, warning, and success at semantic status tokens", () => {
    expect(css).toMatch(/\.callout--error \{[\s\S]*--callout-icon-color:\s*var\(--color-error\)/);
    expect(css).toMatch(
      /\.callout--warning \{[\s\S]*--callout-icon-color:\s*var\(--color-warning\)/,
    );
    expect(css).toMatch(
      /\.callout--success \{[\s\S]*--callout-icon-color:\s*var\(--color-success\)/,
    );
  });

  it("keeps callout-info visually neutral", () => {
    expect(css).toMatch(/\.callout--info \{[\s\S]*--callout-icon-color:\s*#1a1a18/);
    expect(css).not.toMatch(/\.callout--info \{[\s\S]*--color-info/);
  });
});
