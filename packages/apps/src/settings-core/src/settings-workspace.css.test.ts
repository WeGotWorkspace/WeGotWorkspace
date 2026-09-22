import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "settings-workspace.css"), "utf8");
const colorCss = readFileSync(join(here, "../../workspace-shell/src/workspace-color.css"), "utf8");

describe("settings workspace outline chrome", () => {
  it("uses icon tile #003311 as accent; primary fills use accent, not lime", () => {
    expect(css).toMatch(
      /\.settings-workspace \{[\s\S]*?--workspace-accent:\s*var\(--color-we-got-dark\)/,
    );
    expect(colorCss).toMatch(
      /--workspace-accent-strong:\s*color-mix\(\s*in oklch,\s*var\(--workspace-accent\) 32%,\s*var\(--color-ink\)\s*\)/,
    );
    expect(css).toMatch(
      /\.settings-workspace \{[\s\S]*?--button-primary-bg:\s*var\(--workspace-accent\)/,
    );
    expect(css).toMatch(/\.settings-workspace \{[\s\S]*?--button-primary-fg:\s*#ffffff/);
    expect(css).not.toMatch(/--button-primary-bg:\s*var\(--workspace-accent-strong\)/);
    expect(css).not.toMatch(/--workspace-accent:\s*#8[Aa][Cc][Ee]00/);
    expect(css).not.toMatch(/--workspace-accent:\s*#64748b/);
  });

  it("publishes outline tokens on the workspace and view-header (not mint emerald)", () => {
    expect(colorCss).toMatch(
      /--workspace-accent-strong:\s*color-mix\(\s*in oklch,\s*var\(--workspace-accent\) 32%,\s*var\(--color-ink\)\s*\)/,
    );
    expect(css).toMatch(
      /\.settings-workspace \{[\s\S]*--color-emerald:\s*var\(--workspace-accent\)/,
    );
    expect(css).toMatch(
      /\.settings-workspace \{[\s\S]*--button-active-color:\s*var\(--workspace-accent-strong\)/,
    );
    expect(css).toMatch(
      /\.settings-workspace \{[\s\S]*--button-outline-hover-color:\s*var\(--workspace-accent-strong\)/,
    );
    expect(css).toMatch(
      /\.settings-workspace \{[\s\S]*--button-outline-hover-background:[\s\S]*var\(--workspace-accent\) 14%/,
    );
    expect(css).toMatch(
      /\.settings-workspace \{[\s\S]*--button-outline-active-background:[\s\S]*var\(--workspace-accent\) 18%/,
    );
    expect(css).toMatch(
      /\.settings-workspace \.view-header \{[\s\S]*--button-active-color:\s*var\(--workspace-accent-strong\)/,
    );
    expect(css).toMatch(
      /\.settings-workspace \.view-header \{[\s\S]*--button-outline-color:\s*var\(--color-ink\)/,
    );
    expect(css).toMatch(
      /\.settings-workspace \.view-header \{[\s\S]*--button-outline-hover-color:\s*var\(--workspace-accent-strong\)/,
    );
    /* Soft washes live on shared `.view-header` SST (`--workspace-accent` 14/18/24%). */
    expect(css).not.toMatch(
      /\.settings-workspace \.view-header \{[\s\S]*--button-outline-hover-background:[\s\S]*var\(--workspace-accent\) 14%/,
    );
    expect(css).not.toMatch(
      /\.settings-workspace \.view-header \{[\s\S]*--button-outline-active-background:[\s\S]*var\(--workspace-accent\) 18%/,
    );
  });

  it("keeps lockup SVG hexes (tile + lime marks) without lime as UI accent", () => {
    expect(css).toMatch(
      /\.settings-workspace[\s\S]*\.workspace-app-icon--switch-trigger \{[\s\S]*background-color:\s*var\(--color-we-got-dark\)/,
    );
    expect(css).toMatch(
      /\.settings-workspace[\s\S]*\.workspace-app-icon--switch-trigger[\s\S]*svg \{[\s\S]*--wai-bg:\s*var\(--color-we-got-dark\)/,
    );
    expect(css).toMatch(
      /\.settings-workspace[\s\S]*\.workspace-app-icon--switch-trigger[\s\S]*svg \{[\s\S]*--wai-fg:\s*var\(--color-we-got-brat\)/,
    );
  });

  it("uses a light accent→cream sidebar with ink chrome (not full-bleed dark tile)", () => {
    expect(css).toMatch(/--workspace-sidebar-mix:\s*16%/);
    expect(css).toMatch(/--workspace-sidebar-mix:\s*16%/);
    expect(css).not.toMatch(/--app-sidebar-bg:\s*var\(--workspace-accent\)\s*;/);
    expect(css).toMatch(/--app-sidebar-color:\s*var\(--color-ink\)/);
    expect(css).toMatch(/--sidebar-logo-close-button-color:\s*var\(--color-ink\)/);
    expect(css).toMatch(
      /--workspace-user-footer-text-color:\s*color-mix\(in oklch,\s*var\(--color-ink\) 70%/,
    );
    expect(css).not.toMatch(/--app-sidebar-bg:\s*var\(--workspace-accent\)/);
    expect(css).not.toMatch(/--app-sidebar-color:\s*#ffffff/);
    expect(css).not.toMatch(
      /\.settings-workspace \.app-sidebar__scroll \{[\s\S]*--button-active-color:\s*#ffffff/,
    );
    expect(css).not.toMatch(
      /\.settings-workspace \.app-sidebar__scroll \{[\s\S]*--button-outline-hover-background:\s*color-mix\(in oklch,\s*#ffffff 10%/,
    );
  });

  it("uses stronger sidebar item washes with ink on-color for AA", () => {
    expect(css).toMatch(
      /--app-sidebar-item-hover-bg:\s*color-mix\(\s*in oklch,\s*var\(--workspace-accent\) 14%,\s*var\(--color-cream/,
    );
    expect(css).toMatch(
      /--app-sidebar-item-selected-bg:\s*color-mix\(\s*in oklch,\s*var\(--workspace-accent\) 20%,\s*var\(--color-cream/,
    );
    expect(css).toMatch(
      /--app-sidebar-item-selected-hover-bg:\s*color-mix\(\s*in oklch,\s*var\(--workspace-accent\) 28%,\s*var\(--color-cream/,
    );
    expect(css).toMatch(/--app-sidebar-item-selected-color:\s*var\(--color-ink\)/);
    expect(css).not.toMatch(/--app-sidebar-item-selected-color:\s*var\(--color-cream/);
    expect(css).not.toMatch(
      /--app-sidebar-item-selected-color:\s*var\(--workspace-accent-strong\)/,
    );
    expect(css).toMatch(
      /\.settings-workspace \.app-sidebar__scroll \{[\s\S]*--button-outline-hover-color:\s*var\(--color-ink\)/,
    );
  });
});
