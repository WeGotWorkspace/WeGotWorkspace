import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "menu-item.css"), "utf8");

describe("menu-item sidebar surfaces", () => {
  it("washes selected sidebar rows from outline-active tokens", () => {
    expect(css).toMatch(
      /\.sidebar-section \.menu-item--surface-selected \{[\s\S]*--button-outline-active-background/,
    );
    expect(css).toMatch(
      /\.sidebar-section \.menu-item--surface-selected \{[\s\S]*--button-active-color/,
    );
    expect(css).not.toMatch(
      /\.sidebar-section \.menu-item--surface-selected \{[\s\S]*bg-\[color-mix\(in_oklab,var\(--color-ink\)_12%/,
    );
  });

  it("washes idle sidebar hover from outline-hover tokens", () => {
    expect(css).toMatch(
      /\.sidebar-section\s+\.menu-item--interactive:hover:not\(\.menu-item--surface-selected\):not\([\s\S]*--button-outline-hover-color/,
    );
    expect(css).toMatch(
      /\.sidebar-section\s+\.menu-item--interactive:hover:not\(\.menu-item--surface-selected\):not\([\s\S]*--button-outline-hover-background/,
    );
    expect(css).toMatch(
      /\.sidebar-section\s+\.menu-item--interactive:hover:not\(\.menu-item--surface-selected\)\s+\.menu-item__icon-slot \{[\s\S]*opacity:\s*0\.9/,
    );
  });

  it("keeps selected sidebar icons at full opacity for AA-readable glyphs", () => {
    expect(css).toMatch(
      /\.sidebar-section \.menu-item\.menu-item--selected \.menu-item__icon-slot \{[\s\S]*opacity:\s*1/,
    );
  });

  it("washes severity-danger hover from destructive tokens, not accent", () => {
    expect(css).toMatch(/\.menu-item--severity-danger \{[\s\S]*--color-destructive/);
    expect(css).toMatch(
      /\.menu-item--severity-danger\.menu-item--interactive:hover[\s\S]*--menu-item-severity-hover-background/,
    );
    expect(css).toMatch(/menu-item--severity-danger/);
    expect(css).toMatch(
      /\.sidebar-section\s+\.menu-item--interactive:hover:not\(\.menu-item--surface-selected\):not\(/,
    );
  });
});
