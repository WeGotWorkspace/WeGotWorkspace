import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "settings-workspace.css"), "utf8");

describe("settings workspace outline chrome", () => {
  it("uses icon tile #003311 as accent; primary fills use accent, not lime", () => {
    expect(css).toMatch(/\.settings-workspace \{[\s\S]*?--settings-accent:\s*#003311/);
    expect(css).toMatch(
      /--settings-accent-strong:\s*color-mix\(in oklab,\s*var\(--settings-accent\) 32%,\s*var\(--color-ink\)\)/,
    );
    expect(css).toMatch(
      /\.settings-workspace \{[\s\S]*?--button-primary-bg:\s*var\(--settings-accent\)/,
    );
    expect(css).toMatch(/\.settings-workspace \{[\s\S]*?--button-primary-fg:\s*#ffffff/);
    expect(css).not.toMatch(/--button-primary-bg:\s*var\(--settings-accent-strong\)/);
    expect(css).not.toMatch(/--settings-accent:\s*#8[Aa][Cc][Ee]00/);
    expect(css).not.toMatch(/--settings-accent:\s*#64748b/);
  });

  it("publishes outline tokens on the workspace and view-header (not mint emerald)", () => {
    expect(css).toMatch(
      /\.settings-workspace \{[\s\S]*--settings-accent-strong:\s*color-mix\(in oklab,\s*var\(--settings-accent\) 32%,\s*var\(--color-ink\)\)/,
    );
    expect(css).toMatch(
      /\.settings-workspace \{[\s\S]*--color-emerald:\s*var\(--settings-accent\)/,
    );
    expect(css).toMatch(
      /\.settings-workspace \{[\s\S]*--button-active-color:\s*var\(--settings-accent-strong\)/,
    );
    expect(css).toMatch(
      /\.settings-workspace \{[\s\S]*--button-outline-hover-color:\s*var\(--settings-accent-strong\)/,
    );
    expect(css).toMatch(
      /\.settings-workspace \{[\s\S]*--button-outline-hover-background:[\s\S]*var\(--settings-accent\) 14%/,
    );
    expect(css).toMatch(
      /\.settings-workspace \{[\s\S]*--button-outline-active-background:[\s\S]*var\(--settings-accent\) 18%/,
    );
    expect(css).toMatch(
      /\.settings-workspace \.view-header \{[\s\S]*--button-active-color:\s*var\(--settings-accent-strong\)/,
    );
    expect(css).toMatch(
      /\.settings-workspace \.view-header \{[\s\S]*--button-outline-color:\s*var\(--color-ink\)/,
    );
    expect(css).toMatch(
      /\.settings-workspace \.view-header \{[\s\S]*--button-outline-hover-color:\s*var\(--settings-accent-strong\)/,
    );
    /* Soft washes live on shared `.view-header` SST (`--workspace-accent` 14/18/24%). */
    expect(css).not.toMatch(
      /\.settings-workspace \.view-header \{[\s\S]*--button-outline-hover-background:[\s\S]*var\(--settings-accent\) 14%/,
    );
    expect(css).not.toMatch(
      /\.settings-workspace \.view-header \{[\s\S]*--button-outline-active-background:[\s\S]*var\(--settings-accent\) 18%/,
    );
  });

  it("keeps lockup SVG hexes (tile + lime marks) without lime as UI accent", () => {
    expect(css).toMatch(
      /\.settings-workspace[\s\S]*\.workspace-app-icon--switch-trigger \{[\s\S]*background-color:\s*#003311/,
    );
    expect(css).toMatch(
      /\.settings-workspace[\s\S]*\.workspace-app-icon--switch-trigger[\s\S]*svg \{[\s\S]*--wai-bg:\s*#003311/,
    );
    expect(css).toMatch(
      /\.settings-workspace[\s\S]*\.workspace-app-icon--switch-trigger[\s\S]*svg \{[\s\S]*--wai-fg:\s*#8ace00/,
    );
  });

  it("uses a light accent→cream sidebar with ink chrome (not full-bleed dark tile)", () => {
    expect(css).toMatch(
      /--settings-sidebar:\s*color-mix\(in oklab,\s*var\(--settings-accent\) 16%,\s*var\(--color-cream/,
    );
    expect(css).toMatch(/--app-sidebar-bg:\s*var\(--settings-sidebar\)/);
    expect(css).toMatch(/--app-sidebar-color:\s*var\(--color-ink\)/);
    expect(css).toMatch(/--sidebar-logo-close-button-color:\s*var\(--color-ink\)/);
    expect(css).toMatch(
      /--workspace-user-footer-text-color:\s*color-mix\(in oklab,\s*var\(--color-ink\) 70%/,
    );
    expect(css).not.toMatch(/--app-sidebar-bg:\s*var\(--settings-accent\)/);
    expect(css).not.toMatch(/--app-sidebar-color:\s*#ffffff/);
    expect(css).not.toMatch(
      /\.settings-workspace \.app-sidebar__scroll \{[\s\S]*--button-active-color:\s*#ffffff/,
    );
    expect(css).not.toMatch(
      /\.settings-workspace \.app-sidebar__scroll \{[\s\S]*--button-outline-hover-background:\s*color-mix\(in oklab,\s*#ffffff 10%/,
    );
  });

  it("uses stronger sidebar item washes with ink on-color for AA", () => {
    expect(css).toMatch(
      /--app-sidebar-item-hover-bg:\s*color-mix\(\s*in oklab,\s*var\(--settings-accent\) 24%,\s*var\(--color-cream/,
    );
    expect(css).toMatch(
      /--app-sidebar-item-selected-bg:\s*color-mix\(\s*in oklab,\s*var\(--settings-accent\) 36%,\s*var\(--color-cream/,
    );
    expect(css).toMatch(
      /--app-sidebar-item-selected-hover-bg:\s*color-mix\(\s*in oklab,\s*var\(--settings-accent\) 44%,\s*var\(--color-cream/,
    );
    expect(css).toMatch(/--app-sidebar-item-selected-color:\s*var\(--color-ink\)/);
    expect(css).not.toMatch(/--app-sidebar-item-selected-color:\s*var\(--color-cream/);
    expect(css).not.toMatch(/--app-sidebar-item-selected-color:\s*var\(--settings-accent-strong\)/);
    expect(css).toMatch(
      /\.settings-workspace \.app-sidebar__scroll \{[\s\S]*--button-outline-hover-color:\s*var\(--color-ink\)/,
    );
  });
});
