import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "drive-folder-picker.css"), "utf8");

describe("drive folder picker Docs listing theme", () => {
  it("remaps Drive accent tokens and icon paint to Docs accent", () => {
    expect(css).toMatch(
      /\.destination-picker\[data-drive-listing-theme="docs"\] \{[\s\S]*--drive-accent:\s*var\(--docs-accent/,
    );
    expect(css).toMatch(
      /\.destination-picker\[data-drive-listing-theme="docs"\] \{[\s\S]*--color-emerald:\s*var\(--docs-accent/,
    );
    expect(css).toMatch(
      /\.destination-picker\[data-drive-listing-theme="docs"\] \{[\s\S]*--segmented-control-active-bg:\s*var\(--button-outline-active-background\)/,
    );
    expect(css).toMatch(
      /\[data-drive-listing-theme="docs"\][\s\S]*\.drive-folder-tile__icon[\s\S]*color:\s*var\(--docs-accent/,
    );
    expect(css).toMatch(
      /\[data-drive-listing-theme="docs"\][\s\S]*\.drive-list-folder-icon[\s\S]*color:\s*var\(--docs-accent/,
    );
    expect(css).not.toMatch(/\[data-drive-listing-theme="docs"\][\s\S]*#10b981/);
  });
});
