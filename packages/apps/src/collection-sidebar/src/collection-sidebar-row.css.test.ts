import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "collection-sidebar-row.css"), "utf8");

describe("collection sidebar row CSS", () => {
  it("owns hover-only edit on fine pointers", () => {
    expect(css).toMatch(/@media \(hover: hover\) and \(pointer: fine\)/);
    expect(css).toMatch(/\.collection-sidebar-row__action\.button \{[\s\S]*opacity:\s*0/);
    expect(css).toMatch(/\.collection-sidebar-row:hover \.collection-sidebar-row__action\.button/);
    expect(css).toMatch(
      /\.collection-sidebar-row:focus-within \.collection-sidebar-row__action\.button/,
    );
  });

  it("keeps the title shrink-wrapped so marks sit after the name", () => {
    expect(css).toMatch(/\.collection-sidebar-row__title \{[^}]*inline-flex/);
    expect(css.match(/\.collection-sidebar-row__name \{[^}]+\}/)?.[0]).not.toMatch(/flex-1/);
  });

  it("indents nested rows and keeps the fold toggle visible", () => {
    expect(css).toMatch(/\.collection-sidebar-row--nested \{[\s\S]*@apply pl-10/);
    expect(css).toMatch(
      /\.collection-sidebar-row--related:not\(\.collection-sidebar-row--selected\)/,
    );
    expect(css).toMatch(/\.collection-sidebar-row__expand\.button \{[\s\S]*size-6/);
    const hoverHide = css.match(/@media \(hover: hover\) and \(pointer: fine\) \{[\s\S]*$/)?.[0];
    expect(hoverHide).toMatch(/\.collection-sidebar-row__action\.button \{[\s\S]*opacity:\s*0/);
    expect(hoverHide).not.toMatch(/collection-sidebar-row__expand/);
  });

  it("tints the visibility checkbox from --collection-row-color, not parent --checkbox-*", () => {
    const visibility = css.match(/\.collection-sidebar-row__visibility \{[^}]+\}/)?.[0];
    expect(visibility).toMatch(/--checkbox-size:\s*1rem/);
    expect(visibility).toMatch(/--checkbox-checked-bg:\s*var\(--collection-row-color/);
    expect(visibility).toMatch(/--checkbox-checked-border:\s*var\(--collection-row-color/);
    expect(visibility).toMatch(/--checkbox-checked-fg:\s*#ffffff/);
    expect(visibility).toMatch(/--checkbox-border-color:\s*var\(--collection-row-color/);
    expect(visibility).toMatch(/--primary:\s*var\(--collection-row-color/);
  });
});
