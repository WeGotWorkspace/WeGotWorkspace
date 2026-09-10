import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "docs-workspace.css"), "utf8");
const headerActions = readFileSync(join(here, "docs-header-actions.tsx"), "utf8");
const homePane = readFileSync(join(here, "docs-home-pane.tsx"), "utf8");

describe("docs workspace sheet elevation", () => {
  it("reuses the shared --sheet-shadow token for the editor paper sheet", () => {
    expect(css).toMatch(/--text-editor-shadow-sheet:\s*var\(--sheet-shadow\)/);
  });
});

describe("docs workspace outline chrome", () => {
  it("publishes outline tokens on the workspace and view-header (not ink-gray fallback)", () => {
    expect(css).toMatch(
      /\.docs-workspace \{[\s\S]*--button-outline-hover-color:\s*var\(--docs-accent-strong\)/,
    );
    expect(css).toMatch(
      /\.docs-workspace \{[\s\S]*--menu-item-hover-background:[\s\S]*var\(--docs-accent\) 14%/,
    );
    expect(css).toMatch(
      /\.docs-workspace \.view-header \{[\s\S]*--button-outline-color:\s*var\(--color-ink\)/,
    );
    expect(css).toMatch(
      /\.docs-workspace \.view-header \{[\s\S]*--button-outline-hover-color:\s*var\(--docs-accent-strong\)/,
    );
    // Brace must keep surface tokens inside `.docs-workspace` (prior pass regression).
    expect(css).toMatch(
      /\.docs-workspace \{[\s\S]*--foreground:\s*var\(--docs-text\)[\s\S]*background-color:\s*var\(--docs-surface\)/,
    );
  });

  it("forces selected sidebar label on-color to white on the saturated blue wash", () => {
    expect(css).toMatch(
      /\.docs-workspace \.sidebar-section \.menu-item--surface-selected \{[\s\S]*color:\s*#ffffff/,
    );
    expect(css).toMatch(
      /\.docs-workspace \.app-sidebar__scroll \{[\s\S]*--button-active-color:\s*#ffffff/,
    );
    expect(css).toMatch(
      /\.docs-workspace \.app-sidebar__scroll \{[\s\S]*--button-outline-hover-color:\s*#ffffff/,
    );
  });

  it("uses outline IconButtons for header actions and home load-more", () => {
    expect(headerActions).toMatch(/variant="outline"/);
    expect(headerActions).not.toMatch(/variant="subtle"/);
    expect(homePane).toMatch(
      /labels\.homeLoadMore[\s\S]*?variant="outline"|variant="outline"[\s\S]*?labels\.homeLoadMore/,
    );
    expect(homePane).not.toMatch(/homeLoadMore[\s\S]{0,120}variant="subtle"/);
  });
});
