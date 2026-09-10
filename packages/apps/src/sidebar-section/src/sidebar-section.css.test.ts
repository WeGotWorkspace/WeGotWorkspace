import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "sidebar-section.css"), "utf8");

describe("sidebar section padding", () => {
  it("insets the title and menu items with the shared sidebar glyph padding token", () => {
    expect(css).toMatch(
      /\.sidebar-section__heading \{[\s\S]*padding-inline:\s*var\(\s*--app-sidebar-item-padding-x/,
    );
    expect(css).not.toMatch(/\.sidebar-section__heading \{[\s\S]*\bpx-4\b/);
    expect(css).toMatch(
      /\.sidebar-section \.menu-item \{[\s\S]*padding-inline:\s*var\(\s*--app-sidebar-item-padding-x/,
    );
  });
});
