import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "dropdown-menu.css"),
  "utf8",
);

describe("dropdown-menu accent washes", () => {
  it("washes item focus with quiet menu-item hover, not outline/sidebar chip washes", () => {
    expect(css).toMatch(
      /\.dropdown-menu-ui__item:focus(?::not\(\.menu-item--severity-danger\))? \{[\s\S]*--menu-item-hover-background/,
    );
    expect(css).toMatch(
      /\.dropdown-menu-ui__item:focus(?::not\(\.menu-item--severity-danger\))? \{[\s\S]*var\(--workspace-accent,\s*var\(--color-ink\)\) 14%/,
    );
    expect(css).not.toMatch(
      /\.dropdown-menu-ui__item:focus(?::not\(\.menu-item--severity-danger\))? \{[\s\S]*--button-outline-hover-background/,
    );
    expect(css).not.toMatch(/\.dropdown-menu-ui__item:focus \{[\s\S]*@apply bg-accent/);
  });

  it("washes checked checkbox/radio items with quiet selected washes", () => {
    expect(css).toMatch(
      /\.dropdown-menu-ui__checkbox-item\[data-state="checked"\][\s\S]*--menu-item-selected-background/,
    );
    expect(css).toMatch(
      /\.dropdown-menu-ui__checkbox-item\[data-state="checked"\][\s\S]*var\(--workspace-accent,\s*var\(--color-ink\)\) 18%/,
    );
    expect(css).not.toMatch(
      /\.dropdown-menu-ui__checkbox-item\[data-state="checked"\][\s\S]*--button-outline-active-background/,
    );
    expect(css).toMatch(/\.dropdown-menu-ui__indicator-check \{[\s\S]*--button-active-color/);
  });

  it("washes sub-trigger focus/open with quiet menu-item hover", () => {
    expect(css).toMatch(/\.dropdown-menu-ui__sub-trigger:focus[\s\S]*--menu-item-hover-background/);
  });
});
