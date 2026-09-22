import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "drive-workspace.css"), "utf8");
const colorCss = readFileSync(join(here, "../../workspace-shell/src/workspace-color.css"), "utf8");

describe("drive workspace brand accent", () => {
  it("uses tile lime for UI accent with cream-mix strong and accent primary fills", () => {
    expect(css).toMatch(
      /\.drive-workspace \{[\s\S]*?--workspace-accent:\s*var\(--color-we-got-brat\)/i,
    );
    expect(colorCss).toMatch(
      /--workspace-accent-strong:\s*color-mix\(\s*in oklch,\s*var\(--workspace-accent\) 32%,\s*var\(--color-we-got-dark\)\s*\)/,
    );
    expect(css).toMatch(
      /\.drive-workspace \{[\s\S]*?--button-primary-bg:\s*var\(--workspace-accent\)/,
    );
    expect(css).not.toMatch(/--workspace-accent:\s*#10b981/i);
    expect(css).not.toMatch(
      /--workspace-accent-strong:\s*color-mix\(in oklch,\s*var\(--workspace-accent\) 55%,\s*var\(--color-we-got-dark\)\)/,
    );
  });

  it("uses ink on lime for dialog primary fills", () => {
    expect(css).toMatch(
      /\.drive-dialog-surface \{[\s\S]*--workspace-accent:\s*var\(--color-we-got-brat\)/i,
    );
    expect(css).toMatch(
      /\.drive-dialog-surface \{[\s\S]*--button-primary-bg:\s*var\(--workspace-accent\)/,
    );
    expect(css).toMatch(
      /\.drive-dialog-surface \{[\s\S]*--button-primary-fg:\s*var\(--color-we-got-dark/,
    );
  });
});

describe("drive workspace outline-active tokens", () => {
  it("publishes outline-active wash tokens so selected chrome inherits Drive green", () => {
    expect(css).toMatch(/--workspace-accent:\s*var\(--color-we-got-brat\)/);
    expect(css).toMatch(/--button-active-color:\s*var\(--workspace-accent-strong\)/);
    expect(css).toMatch(
      /--button-outline-active-background:\s*color-mix\([\s\S]*var\(--workspace-accent\)\s*55%/,
    );
    expect(css).toMatch(
      /--button-outline-active-hover-background:\s*color-mix\([\s\S]*var\(--workspace-accent\)\s*65%/,
    );
  });

  it("keeps selected washes heavier than the 32% sidebar tint", () => {
    expect(css).toMatch(/--workspace-sidebar-mix:\s*32%/);
    expect(css).not.toMatch(
      /--button-outline-active-background:\s*color-mix\([\s\S]*var\(--workspace-accent\)\s*18%/,
    );
  });

  it("publishes AppSidebar item washes stepped above the 32% rail with ink on-color", () => {
    expect(css).toMatch(
      /--app-sidebar-item-hover-bg:\s*color-mix\(\s*in oklch,\s*var\(--workspace-accent\) 42%,\s*var\(--color-we-got-soft/,
    );
    expect(css).toMatch(
      /--app-sidebar-item-selected-bg:\s*color-mix\(\s*in oklch,\s*var\(--workspace-accent\) 55%,\s*var\(--color-we-got-soft/,
    );
    expect(css).toMatch(
      /--app-sidebar-item-selected-hover-bg:\s*color-mix\(\s*in oklch,\s*var\(--workspace-accent\) 65%,\s*var\(--color-we-got-soft/,
    );
    expect(css).toMatch(/--app-sidebar-item-selected-color:\s*var\(--color-we-got-dark\)/);
    expect(css).toMatch(
      /\.drive-workspace \.app-sidebar__scroll \{[\s\S]*--button-outline-hover-color:\s*var\(--color-we-got-dark\)/,
    );
  });
});

describe("drive workspace app-switch lockup", () => {
  it("keeps the drive.svg tile and folder hexes on the lockup", () => {
    expect(css).toMatch(
      /\.drive-workspace[\s\S]*\.app-switch-button__icon\.workspace-app-icon--switch-trigger \{[\s\S]*background-color:\s*#ffffff/i,
    );
    expect(css).toMatch(
      /\.drive-workspace[\s\S]*\.workspace-app-icon--switch-trigger[\s\S]*svg \{[\s\S]*--wai-bg:\s*#ffffff/i,
    );
    expect(css).toMatch(
      /\.drive-workspace[\s\S]*\.workspace-app-icon--switch-trigger[\s\S]*svg \{[\s\S]*--wai-fg:\s*var\(--color-we-got-brat\)/i,
    );
    expect(css).toMatch(/--app-switch-icon-bg:\s*#ffffff/i);
    expect(css).toMatch(/--app-switch-icon-fg:\s*var\(--color-we-got-brat\)/i);
    expect(css).not.toMatch(/--app-switch-icon-bg:\s*var\(--workspace-accent\)/);
    expect(css).not.toMatch(/--app-switch-icon-fg:\s*var\(--color-we-got-soft/);
    expect(css).not.toMatch(/--wai-bg:\s*transparent/);
    expect(css).not.toMatch(/--wai-fg:\s*var\(--app-switch-icon-fg\)/);
  });
});

describe("drive workspace sidebar primary", () => {
  it("paints New ink-on-green like Tasks/Notes", () => {
    expect(css).toMatch(
      /\.drive-workspace \.app-sidebar__scroll \{[\s\S]*--button-primary-bg:\s*var\(--workspace-accent\)/,
    );
    expect(css).toMatch(
      /\.drive-workspace \.app-sidebar__scroll \{[\s\S]*--button-primary-fg:\s*var\(--color-we-got-dark\)/,
    );
  });

  it("mirrors New CTA primary onto the header notification unread badge", () => {
    expect(css).toMatch(
      /\.drive-workspace \.app-sidebar__notifications \{[\s\S]*--button-primary-bg:\s*var\(--workspace-accent\)/,
    );
    expect(css).toMatch(
      /\.drive-workspace \.app-sidebar__notifications \{[\s\S]*--button-primary-fg:\s*#003311/,
    );
    expect(css).toMatch(
      /\.drive-workspace \.app-sidebar__notifications \{[\s\S]*--notification-inbox-badge-bg:\s*var\(--workspace-accent\)/,
    );
    expect(css).toMatch(
      /\.drive-workspace \.app-sidebar__notifications \{[\s\S]*--notification-inbox-badge-fg:\s*#003311/,
    );
  });
});
