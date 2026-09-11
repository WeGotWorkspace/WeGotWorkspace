import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "admin-workspace.css"), "utf8");

describe("admin workspace outline chrome", () => {
  it("publishes outline tokens on the workspace and view-header (not mint emerald)", () => {
    expect(css).toMatch(
      /\.admin-workspace \{[\s\S]*--admin-accent-strong:\s*color-mix\(in oklab,\s*var\(--admin-accent\) 70%,\s*#0f172a\)/,
    );
    expect(css).toMatch(/\.admin-workspace \{[\s\S]*--workspace-accent:\s*var\(--admin-accent\)/);
    expect(css).toMatch(/\.admin-workspace \{[\s\S]*--color-emerald:\s*var\(--admin-accent\)/);
    expect(css).toMatch(
      /\.admin-workspace \{[\s\S]*--button-active-color:\s*var\(--admin-accent-strong\)/,
    );
    expect(css).toMatch(
      /\.admin-workspace \{[\s\S]*--button-outline-hover-color:\s*var\(--admin-accent-strong\)/,
    );
    expect(css).toMatch(
      /\.admin-workspace \{[\s\S]*--button-outline-hover-background:[\s\S]*var\(--admin-accent\) 14%/,
    );
    expect(css).toMatch(
      /\.admin-workspace \{[\s\S]*--button-outline-active-background:[\s\S]*var\(--admin-accent\) 18%/,
    );
    expect(css).toMatch(
      /\.admin-workspace \{[\s\S]*--button-outline-active-hover-background:[\s\S]*var\(--admin-accent\) 24%/,
    );
    expect(css).toMatch(
      /\.admin-workspace \.view-header \{[\s\S]*--button-active-color:\s*var\(--admin-accent-strong\)/,
    );
    expect(css).toMatch(
      /\.admin-workspace \.view-header \{[\s\S]*--button-outline-color:\s*var\(--color-ink\)/,
    );
    expect(css).toMatch(
      /\.admin-workspace \.view-header \{[\s\S]*--button-outline-hover-color:\s*var\(--admin-accent-strong\)/,
    );
    /* Soft washes live on shared `.view-header` SST (`--workspace-accent` 14/18/24%). */
    expect(css).not.toMatch(
      /\.admin-workspace \.view-header \{[\s\S]*--button-outline-hover-background:[\s\S]*var\(--admin-accent\) 14%/,
    );
    expect(css).not.toMatch(
      /\.admin-workspace \.view-header \{[\s\S]*--button-outline-active-background:[\s\S]*var\(--admin-accent\) 18%/,
    );
  });

  it("keeps white outline remaps on the dark sidebar scroll (not cream accent washes)", () => {
    expect(css).toMatch(
      /\.admin-workspace \.app-sidebar__scroll \{[\s\S]*--button-active-color:\s*#ffffff/,
    );
    expect(css).toMatch(
      /\.admin-workspace \.app-sidebar__scroll \{[\s\S]*--button-outline-hover-background:\s*color-mix\(in oklab,\s*#ffffff 10%/,
    );
  });
});
