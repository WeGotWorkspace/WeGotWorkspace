import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "mail-workspace.css"), "utf8");

describe("mail workspace branding chrome", () => {
  it("uses icon-tile orange for UI accent with cream-mix strong and accent primary fills", () => {
    expect(css).toMatch(/\.mail-workspace \{[\s\S]*?--mail-accent:\s*#de4b0e/);
    expect(css).toMatch(
      /--mail-accent-strong:\s*color-mix\(in oklab,\s*var\(--mail-accent\) 32%,\s*var\(--color-ink\)\)/,
    );
    expect(css).toMatch(/\.mail-workspace \{[\s\S]*?--button-primary-bg:\s*var\(--mail-accent\)/);
    expect(css).toMatch(/\.mail-workspace \{[\s\S]*?--button-primary-fg:\s*#ffffff/);
    expect(css).toMatch(
      /\.mail-workspace \{[\s\S]*?--sidebar-badge-bg:\s*var\(--button-primary-bg\)/,
    );
    expect(css).toMatch(
      /\.mail-workspace \{[\s\S]*?--sidebar-badge-fg:\s*var\(--button-primary-fg\)/,
    );
    expect(css).not.toMatch(/--sidebar-badge-fg:\s*var\(--mail-accent\)/);
    expect(css).not.toMatch(/--button-primary-bg:\s*var\(--mail-accent-strong\)/);
    expect(css).not.toMatch(/--mail-accent:\s*#ef4444/);
    expect(css).not.toMatch(/--mail-sidebar:\s*#d9254f/);
  });

  it("keeps switch-trigger lockup on orange tile + pink marks", () => {
    expect(css).toMatch(
      /\.workspace-app-icon--switch-trigger \{[\s\S]*background-color:\s*#de4b0e/,
    );
    expect(css).toMatch(
      /\.workspace-app-icon--switch-trigger[\s\S]*svg \{[\s\S]*--wai-bg:\s*#de4b0e/,
    );
    expect(css).toMatch(
      /\.workspace-app-icon--switch-trigger[\s\S]*svg \{[\s\S]*--wai-fg:\s*#ffbdc2/,
    );
  });

  it("washes cream sidebar for orange and dials header outline chips with accent-strong", () => {
    expect(css).toMatch(
      /--mail-sidebar:\s*color-mix\(in oklab,\s*var\(--mail-accent\) 12%,\s*var\(--color-cream/,
    );
    expect(css).toMatch(/\.mail-workspace \{[\s\S]*--app-sidebar-color:\s*var\(--color-ink\)/);
    expect(css).toMatch(
      /--app-sidebar-item-hover-bg:\s*color-mix\(\s*in oklab,\s*var\(--mail-accent\) 28%,\s*var\(--color-cream/,
    );
    expect(css).toMatch(
      /\.mail-workspace \{[\s\S]*--app-sidebar-item-selected-bg:[\s\S]*var\(--mail-accent\) 38%[\s\S]*var\(--color-cream/,
    );
    expect(css).toMatch(
      /\.mail-workspace \{[\s\S]*--app-sidebar-item-selected-hover-bg:[\s\S]*var\(--mail-accent\) 48%[\s\S]*var\(--color-cream/,
    );
    expect(css).toMatch(
      /\.mail-workspace \{[\s\S]*--app-sidebar-item-selected-color:\s*var\(--color-ink\)/,
    );
    expect(css).toMatch(
      /\.mail-workspace \.app-sidebar__scroll \{[\s\S]*--button-outline-hover-color:\s*var\(--color-ink\)/,
    );
    expect(css).toMatch(
      /\.mail-workspace \.view-header \{[\s\S]*--button-active-color:\s*var\(--mail-accent-strong\)/,
    );
    expect(css).toMatch(
      /\.mail-workspace \.view-header \{[\s\S]*--button-outline-hover-color:\s*var\(--mail-accent-strong\)/,
    );
    expect(css).toMatch(
      /:is\(\.mail-compose-dialog-surface,\s*\.mail-dialog-surface\) \{[\s\S]*?--mail-accent:\s*#de4b0e/,
    );
    expect(css).toMatch(
      /:is\(\.mail-compose-dialog-surface,\s*\.mail-dialog-surface\) \{[\s\S]*?--button-primary-bg:\s*var\(--mail-accent\)/,
    );
  });
});
