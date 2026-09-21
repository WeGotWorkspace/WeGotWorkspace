import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "drive-workspace.css"), "utf8");

describe("drive workspace brand accent", () => {
  it("uses tile lime for UI accent with cream-mix strong and accent primary fills", () => {
    expect(css).toMatch(/\.drive-workspace \{[\s\S]*?--drive-accent:\s*#8ace00/i);
    expect(css).toMatch(
      /--drive-accent-strong:\s*color-mix\(in oklab,\s*var\(--drive-accent\) 32%,\s*var\(--color-ink\)\)/,
    );
    expect(css).toMatch(/\.drive-workspace \{[\s\S]*?--button-primary-bg:\s*var\(--drive-accent\)/);
    expect(css).not.toMatch(/--drive-accent:\s*#10b981/i);
    expect(css).not.toMatch(
      /--drive-accent-strong:\s*color-mix\(in oklab,\s*var\(--drive-accent\) 55%,\s*var\(--color-ink\)\)/,
    );
  });

  it("uses ink on lime for dialog primary fills", () => {
    expect(css).toMatch(/\.drive-dialog-surface \{[\s\S]*--drive-accent:\s*#8ace00/i);
    expect(css).toMatch(
      /\.drive-dialog-surface \{[\s\S]*--button-primary-bg:\s*var\(--drive-accent\)/,
    );
    expect(css).toMatch(/\.drive-dialog-surface \{[\s\S]*--button-primary-fg:\s*var\(--color-ink/);
  });
});

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

  it("publishes AppSidebar item washes stepped above the 32% rail with ink on-color", () => {
    expect(css).toMatch(
      /--app-sidebar-item-hover-bg:\s*color-mix\(\s*in oklab,\s*var\(--drive-accent\) 42%,\s*var\(--color-cream/,
    );
    expect(css).toMatch(
      /--app-sidebar-item-selected-bg:\s*color-mix\(\s*in oklab,\s*var\(--drive-accent\) 55%,\s*var\(--color-cream/,
    );
    expect(css).toMatch(
      /--app-sidebar-item-selected-hover-bg:\s*color-mix\(\s*in oklab,\s*var\(--drive-accent\) 65%,\s*var\(--color-cream/,
    );
    expect(css).toMatch(/--app-sidebar-item-selected-color:\s*var\(--color-ink\)/);
    expect(css).toMatch(
      /\.drive-workspace \.app-sidebar__scroll \{[\s\S]*--button-outline-hover-color:\s*var\(--color-ink\)/,
    );
  });
});

describe("drive workspace app-switch lockup", () => {
  it("keeps the drive.svg tile and folder hexes on the lockup", () => {
    expect(css).toMatch(
      /\.drive-workspace[\s\S]*\.app-switch-button__icon\.workspace-app-icon--switch-trigger \{[\s\S]*background-color:\s*#8ace00/i,
    );
    expect(css).toMatch(
      /\.drive-workspace[\s\S]*\.workspace-app-icon--switch-trigger[\s\S]*svg \{[\s\S]*--wai-bg:\s*#8ace00/i,
    );
    expect(css).toMatch(
      /\.drive-workspace[\s\S]*\.workspace-app-icon--switch-trigger[\s\S]*svg \{[\s\S]*--wai-fg:\s*#1d6635/i,
    );
    expect(css).toMatch(/--app-switch-icon-bg:\s*#8ace00/i);
    expect(css).toMatch(/--app-switch-icon-fg:\s*#1d6635/i);
    expect(css).not.toMatch(/--app-switch-icon-bg:\s*var\(--drive-accent\)/);
    expect(css).not.toMatch(/--app-switch-icon-fg:\s*var\(--color-cream/);
    expect(css).not.toMatch(/--wai-bg:\s*transparent/);
    expect(css).not.toMatch(/--wai-fg:\s*var\(--app-switch-icon-fg\)/);
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

  it("mirrors New CTA primary onto the header notification unread badge", () => {
    expect(css).toMatch(
      /\.drive-workspace \.app-sidebar__notifications \{[\s\S]*--button-primary-bg:\s*var\(--drive-accent\)/,
    );
    expect(css).toMatch(
      /\.drive-workspace \.app-sidebar__notifications \{[\s\S]*--button-primary-fg:\s*#042a22/,
    );
    expect(css).toMatch(
      /\.drive-workspace \.app-sidebar__notifications \{[\s\S]*--notification-inbox-badge-bg:\s*var\(--drive-accent\)/,
    );
    expect(css).toMatch(
      /\.drive-workspace \.app-sidebar__notifications \{[\s\S]*--notification-inbox-badge-fg:\s*#042a22/,
    );
  });
});
