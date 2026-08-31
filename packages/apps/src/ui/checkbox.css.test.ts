import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "checkbox.css"), "utf8");

describe("checkbox CSS tokens", () => {
  it("exposes shared size, radius, accent, and focus tokens on the primitive", () => {
    expect(css).toMatch(/\.checkbox \{[\s\S]*--checkbox-size, 1rem/);
    expect(css).toMatch(/\.checkbox \{[\s\S]*--checkbox-radius, var\(--radius-sm\)/);
    expect(css).toMatch(
      /\.checkbox\[data-state="checked"\] \{[\s\S]*--checkbox-checked-bg, var\(--primary\)/,
    );
    expect(css).toMatch(/\.checkbox \{[\s\S]*--checkbox-ring-color, var\(--ring\)/);
    expect(css).toMatch(/\.checkbox \{[\s\S]*focus-visible:ring-1/);
  });
});
