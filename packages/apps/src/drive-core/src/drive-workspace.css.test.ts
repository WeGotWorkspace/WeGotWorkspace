import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "drive-workspace.css"), "utf8");

describe("drive workspace outline-active tokens", () => {
  it("publishes outline-active wash tokens so selected chrome inherits Drive green", () => {
    expect(css).toMatch(/--workspace-accent:\s*var\(--drive-accent\)/);
    expect(css).toMatch(/--button-active-color:\s*var\(--drive-accent-strong\)/);
    expect(css).toMatch(
      /--button-outline-active-background:\s*color-mix\([\s\S]*var\(--drive-accent\)\s*55%/,
    );
    expect(css).toMatch(
      /--button-outline-active-hover-background:\s*color-mix\([\s\S]*var\(--drive-accent\)\s*65%/,
    );
  });

  it("keeps selected washes heavier than the 32% sidebar tint", () => {
    expect(css).toMatch(/--drive-sidebar:\s*color-mix\(in oklab,\s*var\(--drive-accent\)\s*32%/);
    expect(css).not.toMatch(
      /--button-outline-active-background:\s*color-mix\([\s\S]*var\(--drive-accent\)\s*18%/,
    );
  });

  it("does not republish --app-sidebar-item-* (shared AppSidebar wash is enough)", () => {
    expect(css).not.toMatch(/--app-sidebar-item-hover-bg:/);
    expect(css).not.toMatch(/--app-sidebar-item-selected-bg:/);
    expect(css).not.toMatch(/--app-sidebar-item-selected-hover-bg:/);
    expect(css).not.toMatch(/--app-sidebar-item-selected-color:/);
  });
});

describe("drive workspace app-switch lockup", () => {
  it("uses green tile + cream glyph (classic Drive brand)", () => {
    expect(css).toMatch(
      /\.drive-workspace[\s\S]*\.app-switch-button__icon\.workspace-app-icon--switch-trigger \{[\s\S]*--app-switch-icon-bg:\s*var\(--drive-accent\)/,
    );
    expect(css).toMatch(
      /\.drive-workspace[\s\S]*\.app-switch-button__icon\.workspace-app-icon--switch-trigger \{[\s\S]*--app-switch-icon-fg:\s*var\(--color-cream/,
    );
    expect(css).toMatch(
      /\.drive-workspace[\s\S]*\.workspace-app-icon--switch-trigger[\s\S]*svg \{[\s\S]*--wai-fg:\s*var\(--app-switch-icon-fg\)/,
    );
  });
});

describe("drive workspace sidebar primary", () => {
  it("paints New ink-on-green like Tasks/Notes", () => {
    expect(css).toMatch(
      /\.drive-workspace \.app-sidebar__scroll \{[\s\S]*--button-primary-bg:\s*var\(--drive-accent\)/,
    );
    expect(css).toMatch(
      /\.drive-workspace \.app-sidebar__scroll \{[\s\S]*--button-primary-fg:\s*var\(--color-ink\)/,
    );
  });
});
