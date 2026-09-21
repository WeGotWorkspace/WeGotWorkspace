import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "mail-workspace.css"), "utf8");

describe("mail workspace sidebar nav AA washes", () => {
  it("darkens crimson item washes and keeps white on-color (not white transparent)", () => {
    expect(css).toMatch(/--mail-sidebar:\s*#d9254f/);
    expect(css).toMatch(/--app-sidebar-color:\s*#ffffff/);
    expect(css).toMatch(
      /\.mail-workspace \.app-sidebar__scroll \{[\s\S]*--app-sidebar-item-hover-bg:\s*color-mix\(\s*in oklab,\s*#000000 10%,\s*var\(--mail-sidebar\)/,
    );
    expect(css).toMatch(
      /\.mail-workspace \.app-sidebar__scroll \{[\s\S]*--app-sidebar-item-selected-bg:\s*color-mix\(\s*in oklab,\s*#000000 14%,\s*var\(--mail-sidebar\)/,
    );
    expect(css).toMatch(
      /\.mail-workspace \.app-sidebar__scroll \{[\s\S]*--app-sidebar-item-selected-hover-bg:\s*color-mix\(\s*in oklab,\s*#000000 20%,\s*var\(--mail-sidebar\)/,
    );
    expect(css).toMatch(
      /\.mail-workspace \.app-sidebar__scroll \{[\s\S]*--app-sidebar-item-selected-color:\s*#ffffff/,
    );
    expect(css).toMatch(
      /\.mail-workspace \.app-sidebar__scroll \{[\s\S]*--button-outline-hover-color:\s*#ffffff/,
    );
    expect(css).not.toMatch(
      /\.mail-workspace \.app-sidebar__scroll \{[\s\S]*--button-outline-hover-background:\s*color-mix\(in oklab,\s*#ffffff/,
    );
  });
});
