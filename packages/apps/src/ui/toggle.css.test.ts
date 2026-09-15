import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "toggle.css"), "utf8");

describe("toggle radius", () => {
  it("uses shared --control-radius like Button (no pill override on the root)", () => {
    expect(css).toMatch(/\.toggle \{[\s\S]*?border-radius:\s*var\(--control-radius\)/);
    expect(css).not.toMatch(
      /\.toggle \{[\s\S]*?border-radius:\s*var\(--control-radius-button-pill\)/,
    );
  });
});
