import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "drive-browser.css"), "utf8");
const docsHomeCss = readFileSync(join(here, "../../docs-core/src/docs-home-workspace.css"), "utf8");

describe("drive browser grid + tile chrome (canonical for Docs + Drive)", () => {
  it("keeps ≥2 columns via gap-aware auto-fill minmax", () => {
    expect(css).toMatch(/--drive-grid-gap/);
    expect(css).toMatch(
      /grid-template-columns:\s*repeat\(\s*auto-fill,\s*minmax\(\s*min\(\s*13\.5rem,\s*calc\(\(100% - var\(--drive-grid-gap\)\) \/ 2\)\s*\),\s*1fr\s*\)\s*\)/,
    );
  });

  it("uses white idle tiles with ::after accent hairline and selected washes", () => {
    expect(css).toMatch(/\.drive-file-tile::after/);
    expect(css).toMatch(
      /\.drive-file-tile--selected\s+\.drive-file-tile__preview\s*\{[\s\S]*drive-accent[\s\S]*10%/,
    );
    expect(css).toMatch(
      /\.drive-file-tile--selected\s+\.drive-file-tile__footer\s*\{[\s\S]*drive-accent[\s\S]*14%/,
    );
    expect(css).toMatch(
      /\.drive-folder-tile--selected\s*\{[\s\S]*drive-accent[\s\S]*12%[\s\S]*box-shadow:\s*none/,
    );
    expect(css).toMatch(/\.drive-list-row--selected\s*>\s*td\s*\{[\s\S]*drive-accent[\s\S]*12%/);
  });

  it("adds idle hover washes lighter than selected accent mixes", () => {
    expect(css).toMatch(/\.drive-folder-tile--idle:hover\s*\{[\s\S]*drive-accent[\s\S]*8%/);
    expect(css).toMatch(
      /\.drive-file-tile:not\(\.drive-file-tile--selected\):hover\s+\.drive-file-tile__preview\s*\{[\s\S]*drive-accent[\s\S]*6%/,
    );
    expect(css).toMatch(
      /\.drive-file-tile:not\(\.drive-file-tile--selected\):hover\s+\.drive-file-tile__footer\s*\{[\s\S]*drive-accent[\s\S]*8%/,
    );
    expect(css).toMatch(
      /\.drive-list-row:not\(\.drive-list-row--selected\):not\(\.drive-list-row--drop-target\):hover\s*>\s*td\s*\{[\s\S]*drive-accent[\s\S]*8%/,
    );
  });

  it("does not re-fork tile/grid chrome under docs-home-workspace", () => {
    expect(docsHomeCss).not.toMatch(/\.docs-home-workspace[\s\S]*\.drive-grid\s*\{/);
    expect(docsHomeCss).not.toMatch(/\.drive-file-tile::after/);
    expect(docsHomeCss).not.toMatch(/\.drive-file-tile--selected/);
  });

  it("keeps tile title + share indicators adjacent (no flex-1 on title)", () => {
    expect(css).toMatch(
      /\.drive-file-tile__title-row\s*\{[\s\S]*?@apply flex min-w-0 items-center/,
    );
    const applyLine = css.match(
      /\.drive-workspace \.drive-file-tile__title\s*\{[^}]*@apply ([^;]+);/,
    )?.[1];
    expect(applyLine).toBeTruthy();
    expect(applyLine).toMatch(/min-w-0/);
    expect(applyLine).toMatch(/truncate/);
    expect(applyLine).not.toMatch(/flex-1/);
  });
});
