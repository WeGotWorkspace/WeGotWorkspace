import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "settings-workspace.css"), "utf8");

describe("settings workspace outline chrome", () => {
  it("publishes outline tokens on the workspace and view-header (not mint emerald)", () => {
    expect(css).toMatch(
      /\.settings-workspace \{[\s\S]*--settings-accent-strong:\s*color-mix\(in oklab,\s*var\(--settings-accent\) 70%,\s*#0f172a\)/,
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

  it("keeps white outline remaps on the dark sidebar scroll (not cream accent washes)", () => {
    expect(css).toMatch(
      /\.settings-workspace \.app-sidebar__scroll \{[\s\S]*--button-active-color:\s*#ffffff/,
    );
    expect(css).toMatch(
      /\.settings-workspace \.app-sidebar__scroll \{[\s\S]*--button-outline-hover-background:\s*color-mix\(in oklab,\s*#ffffff 10%/,
    );
  });
});
