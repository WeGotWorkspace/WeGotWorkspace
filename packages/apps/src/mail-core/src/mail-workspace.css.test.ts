import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "mail-workspace.css"), "utf8");
const colorCss = readFileSync(join(here, "../../workspace-shell/src/workspace-color.css"), "utf8");

describe("mail workspace branding chrome", () => {
  it("imports shared color sheet and sets We Got Red accent", () => {
    expect(css).toMatch(/@import\s+"\.\.\/\.\.\/workspace-shell\/src\/workspace-color\.css"/);
    expect(css).toMatch(
      /\.mail-workspace \{[\s\S]*?--workspace-accent:\s*var\(--color-we-got-red\)/,
    );
    expect(colorCss).toMatch(
      /--workspace-accent-strong:\s*color-mix\(\s*in oklch,\s*var\(--workspace-accent\) 32%,\s*var\(--color-we-got-dark\)\s*\)/,
    );
    expect(css).toMatch(
      /\.mail-workspace \{[\s\S]*?--button-primary-bg:\s*color-mix\(in oklch,\s*var\(--workspace-accent\) 90%,\s*var\(--color-we-got-dark\)\)/,
    );
    expect(css).toMatch(/\.mail-workspace \{[\s\S]*?--button-primary-fg:\s*#ffffff/);
    expect(css).toMatch(
      /\.mail-workspace \{[\s\S]*?--sidebar-badge-bg:\s*var\(--button-primary-bg\)/,
    );
    expect(css).toMatch(
      /\.mail-workspace \{[\s\S]*?--sidebar-badge-fg:\s*var\(--button-primary-fg\)/,
    );
    expect(css).not.toMatch(/--sidebar-badge-fg:\s*var\(--workspace-accent\)/);
    expect(css).not.toMatch(/--button-primary-bg:\s*var\(--workspace-accent-strong\)/);
  });

  it("keeps switch-trigger lockup on red tile + pink marks", () => {
    expect(css).toMatch(
      /\.workspace-app-icon--switch-trigger \{[\s\S]*background-color:\s*color-mix\(in oklch,\s*var\(--color-we-got-red\) 90%,\s*var\(--color-we-got-dark\)\)/,
    );
    expect(css).toMatch(
      /\.workspace-app-icon--switch-trigger[\s\S]*svg \{[\s\S]*--wai-bg:\s*color-mix\(in oklch,\s*var\(--color-we-got-red\) 90%,\s*var\(--color-we-got-dark\)\)/,
    );
    expect(css).toMatch(
      /\.workspace-app-icon--switch-trigger[\s\S]*svg \{[\s\S]*--wai-fg:\s*var\(--color-we-got-pink\)/,
    );
  });

  it("keeps AA-tuned item washes and accent-strong header chrome", () => {
    expect(colorCss).toMatch(
      /--app-sidebar-bg:\s*color-mix\(\s*in oklch,\s*var\(--workspace-accent\) var\(--workspace-sidebar-mix\),\s*var\(--color-we-got-soft\)/,
    );
    expect(css).toMatch(
      /\.mail-workspace \{[\s\S]*--app-sidebar-color:\s*var\(--color-we-got-dark\)/,
    );
    expect(css).toMatch(
      /--app-sidebar-item-hover-bg:\s*color-mix\(\s*in oklch,\s*var\(--workspace-accent\) 28%,\s*var\(--color-we-got-soft/,
    );
    expect(css).toMatch(
      /\.mail-workspace \{[\s\S]*--app-sidebar-item-selected-bg:[\s\S]*var\(--workspace-accent\) 38%[\s\S]*var\(--color-we-got-soft/,
    );
    expect(css).toMatch(
      /\.mail-workspace \{[\s\S]*--app-sidebar-item-selected-hover-bg:[\s\S]*var\(--workspace-accent\) 48%[\s\S]*var\(--color-we-got-soft/,
    );
    expect(css).toMatch(
      /\.mail-workspace \{[\s\S]*--app-sidebar-item-selected-color:\s*var\(--color-we-got-dark\)/,
    );
    expect(css).toMatch(
      /\.mail-workspace \.app-sidebar__scroll \{[\s\S]*--button-outline-hover-color:\s*var\(--color-we-got-dark\)/,
    );
    expect(css).toMatch(
      /\.mail-workspace \.view-header \{[\s\S]*--button-active-color:\s*var\(--workspace-accent-strong\)/,
    );
    expect(css).toMatch(
      /\.mail-workspace \.view-header \{[\s\S]*--button-outline-hover-color:\s*var\(--workspace-accent-strong\)/,
    );
    expect(css).toMatch(
      /:is\(\.mail-compose-dialog-surface,\s*\.mail-dialog-surface\) \{[\s\S]*?--workspace-accent:\s*var\(--color-we-got-red\)/,
    );
    expect(css).toMatch(
      /:is\(\.mail-compose-dialog-surface,\s*\.mail-dialog-surface\) \{[\s\S]*?--button-primary-bg:\s*color-mix\(in oklch,\s*var\(--workspace-accent\) 90%,\s*var\(--color-we-got-dark\)\)/,
    );
  });
});
