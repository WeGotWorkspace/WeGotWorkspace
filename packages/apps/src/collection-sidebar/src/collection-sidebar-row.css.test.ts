import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "collection-sidebar-row.css"), "utf8");

describe("collection sidebar row CSS", () => {
  it("stretches the select control over the full row hover box", () => {
    expect(css).toMatch(/\.collection-sidebar-row \{[\s\S]*@apply relative flex/);
    expect(css).toMatch(
      /\.collection-sidebar-row__select::after \{[\s\S]*position:\s*absolute;[\s\S]*inset:\s*0/,
    );
    expect(css).toMatch(
      /\.collection-sidebar-row:has\(> \.collection-sidebar-row__select:focus-visible\)/,
    );
    expect(css).toMatch(/\.collection-sidebar-row__visibility \{[\s\S]*@apply relative z-10/);
    expect(css).toMatch(/\.collection-sidebar-row__action\.button,[\s\S]*@apply relative z-10/);
    expect(css).toMatch(/\.collection-sidebar-row__trailing \{[\s\S]*@apply relative z-10/);
  });

  it("insets row content with the shared sidebar glyph padding token, not px-4", () => {
    const idle = css.match(/\.collection-sidebar-row \{[^}]+\}/)?.[0];
    expect(idle).toMatch(
      /padding-inline:\s*var\(\s*--app-sidebar-item-padding-x,\s*calc\(2 \* 1\.875rem \* 0\.85 \* 112 \/ 512\)\s*\)/,
    );
    expect(idle).not.toMatch(/\bpx-4\b/);
  });

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

  it("keeps a transparent 1px border in all states and keyboard focus ring", () => {
    const idle = css.match(/\.collection-sidebar-row \{[^}]+\}/)?.[0];
    expect(idle).toMatch(/border:\s*1px solid transparent/);
    expect(idle).toMatch(/background-color:\s*transparent/);
    expect(idle).not.toMatch(/--control-border-color/);
    expect(css).toMatch(
      /\.collection-sidebar-row:hover:not\(\.collection-sidebar-row--selected\) \{[\s\S]*border-color:\s*transparent/,
    );
    expect(css).toMatch(/\.collection-sidebar-row--selected \{[\s\S]*border-color:\s*transparent/);
    expect(css).toMatch(
      /\.collection-sidebar-row:hover:not\(\.collection-sidebar-row--selected\) \{[\s\S]*--button-outline-hover-background[\s\S]*color-mix\(\s*in oklab,\s*var\(--color-ink\)\s*8%/,
    );
    expect(css).toMatch(
      /\.collection-sidebar-row:hover:not\(\.collection-sidebar-row--selected\) \{[\s\S]*--button-outline-hover-color/,
    );
    expect(css).toMatch(
      /\.collection-sidebar-row:has\(> \.collection-sidebar-row__select:focus-visible\) \{[\s\S]*ring-1 ring-ring/,
    );
    expect(css).not.toMatch(
      /\.collection-sidebar-row:has\(> \.collection-sidebar-row__select:focus-visible\) \{[\s\S]*outline:\s*2px/,
    );
  });

  it("washes the selected row like outline icon-button--active (accent fg, no stroke)", () => {
    const selected = css.match(/\.collection-sidebar-row--selected \{[^}]+\}/)?.[0];
    expect(selected).toMatch(
      /color:\s*var\(\s*--collection-sidebar-row-selected-color,\s*var\(--button-active-color,\s*var\(--color-emerald\)\)\s*\)/,
    );
    expect(selected).toMatch(/border-color:\s*transparent/);
    expect(selected).not.toMatch(/--button-outline-active-border-color/);
    expect(selected).not.toMatch(/--control-border-color/);
    expect(selected).toMatch(/--button-outline-active-background/);
    expect(selected).not.toMatch(/--collection-row-color/);
    expect(selected).not.toMatch(/var\(--color-ink\)\s*12%/);
    expect(selected).not.toMatch(/--workspace-accent/);
    expect(css).toMatch(
      /\.collection-sidebar-row--selected:hover \{[\s\S]*--button-outline-active-hover-background/,
    );
  });
});
