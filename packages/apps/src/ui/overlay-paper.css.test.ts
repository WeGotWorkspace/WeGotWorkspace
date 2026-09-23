import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "overlay-paper.css"), "utf8");
const dialog = readFileSync(join(here, "dialog.tsx"), "utf8");
const alertDialog = readFileSync(join(here, "alert-dialog.tsx"), "utf8");
const popover = readFileSync(join(here, "popover.tsx"), "utf8");

describe("overlay paper", () => {
  it("paints light dialogs and popovers with the login surface and field wash", () => {
    expect(css).toMatch(
      /\.overlay-paper:not\(\.meet-dialog-surface\):not\(\.meet-popover-surface\)/,
    );
    expect(css).toMatch(/background-color:\s*var\(--color-we-got-soft\)/);
    expect(css).toMatch(
      /--input-background:\s*color-mix\(\s*in oklab,\s*var\(--color-we-got-dark\) 6%,\s*var\(--color-we-got-soft\)\)/,
    );
    expect(css).toMatch(
      /--input-background-focus:\s*color-mix\(\s*in oklab,\s*var\(--color-we-got-dark\) 8%,\s*var\(--color-we-got-soft\)\s*\)/,
    );
    expect(css).toMatch(/--card-surface-bg:\s*transparent/);
    expect(css).toMatch(/--card-panel-bg:\s*transparent/);
    expect(css).toMatch(/--workspace-surface:\s*var\(--color-we-got-soft\)/);
  });

  it("is on dialog, alert dialog, and popover surfaces", () => {
    expect(dialog).toMatch(/overlay-paper/);
    expect(alertDialog).toMatch(/overlay-paper/);
    expect(popover).toMatch(/overlay-paper/);
    expect(dialog).toMatch(/import "@\/ui\/overlay-paper.css"/);
    expect(alertDialog).toMatch(/import "@\/ui\/overlay-paper.css"/);
    expect(popover).toMatch(/import "@\/ui\/overlay-paper.css"/);
  });
});
