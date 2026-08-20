import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "swatch-color-picker.css"), "utf8");

describe("swatch color picker CSS", () => {
  it("keeps the native well a real-sized overlay instead of sr-only", () => {
    expect(css).toMatch(/\.swatch-color-picker__native-color \{[\s\S]*fixed/);
    expect(css).toMatch(/\.swatch-color-picker__native-color \{[\s\S]*opacity-\[0\.01\]/);
    expect(css).not.toMatch(/\.swatch-color-picker__native-color \{[\s\S]*sr-only/);
    expect(css).toMatch(/@media \(pointer: coarse\)/);
  });
});
