import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "color-swatch-trigger.css"), "utf8");

describe("color swatch trigger CSS", () => {
  it("pins unlabeled swatches with higher specificity than control-surface w-full", () => {
    expect(css).toMatch(
      /\.control-surface\.color-swatch-trigger:not\(\.color-swatch-trigger--labeled\) \{[\s\S]*width:\s*auto/,
    );
    expect(css).toMatch(/\.control-surface\.color-swatch-trigger--labeled \{[\s\S]*width:\s*100%/);
    expect(css).toMatch(/\.color-swatch-trigger \{[\s\S]*min-width:\s*3\.25rem/);
  });
});
