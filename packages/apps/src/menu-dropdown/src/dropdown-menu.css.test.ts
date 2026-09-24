import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "dropdown-menu.css"),
  "utf8",
);

describe("dropdown-menu severity washes", () => {
  it("keeps accent hover off severity-danger rows", () => {
    expect(css).toMatch(
      /\.dropdown-menu__menu-item\.menu-item--interactive:hover:not\(\.menu-item--severity-danger\)/,
    );
    expect(css).toMatch(
      /\.dropdown-menu__menu-item\.menu-item--severity-danger\.menu-item--interactive:hover[\s\S]*--menu-item-severity-hover-background/,
    );
    expect(css).toMatch(
      /\.dropdown-menu__menu-item\.menu-item--severity-danger\.menu-item--interactive:hover[\s\S]*--color-destructive/,
    );
  });
});
