import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "sidebar-section.css"), "utf8");
const tsx = readFileSync(join(here, "sidebar-section.tsx"), "utf8");

describe("sidebar section padding", () => {
  it("insets the title and menu items with the shared sidebar glyph padding token", () => {
    expect(css).toMatch(
      /\.sidebar-section__heading \{[\s\S]*padding-inline:\s*var\(\s*--app-sidebar-item-padding-x/,
    );
    expect(css).not.toMatch(/\.sidebar-section__heading \{[\s\S]*\bpx-4\b/);
    expect(css).toMatch(
      /\.sidebar-section \.menu-item \{[\s\S]*padding-inline:\s*var\(\s*--app-sidebar-item-padding-x/,
    );
    expect(css).toMatch(
      /\.sidebar-section \.menu-item \{[\s\S]*min-height:\s*var\(\s*--app-sidebar-item-height,\s*var\(--control-height-md,\s*2\.25rem\)/,
    );
  });

  it("pins the section add control to xs so md IconButtons cannot stretch the heading", () => {
    expect(tsx).toMatch(/size="xs"/);
    expect(css).toMatch(
      /\.sidebar-section \.sidebar-section__add \{[\s\S]*min-height:\s*var\(--control-height-xs,\s*1\.75rem\)/,
    );
    expect(css).toMatch(
      /\.sidebar-section__heading \{[\s\S]*min-height:\s*var\(--control-height-xs,\s*1\.75rem\)/,
    );
    expect(css).not.toMatch(/\.sidebar-section__heading \{[\s\S]*\bh-6\b/);
  });

  it("uses a tight spacing-token margin under the heading and 1px tracking on the h4", () => {
    expect(css).toMatch(
      /\.sidebar-section__heading \{[\s\S]*margin-bottom:\s*calc\(\s*var\(\s*--spacing,\s*0\.25rem\)\s*\*\s*1\s*\)/,
    );
    expect(css).not.toMatch(/\.sidebar-section__heading \{[\s\S]*\bmb-3\b/);
    expect(css).toMatch(/\.sidebar-section__heading h4 \{[\s\S]*letter-spacing:\s*1px/);
  });
});
