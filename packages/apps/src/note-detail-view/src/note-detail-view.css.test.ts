import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "note-detail-view.css"), "utf8");
const paperSheet = readFileSync(join(here, "../../ui/paper-sheet.css"), "utf8");
const styles = readFileSync(join(here, "../../styles.css"), "utf8");

describe("note-detail-view paper sheet CSS", () => {
  it("layouts the open note on the shared paper-sheet surface", () => {
    expect(paperSheet).toMatch(/\.paper-sheet \{[\s\S]*border-radius:\s*0/);
    expect(paperSheet).toMatch(
      /\.paper-sheet \{[\s\S]*background-color:\s*var\(--paper-sheet-bg\)/,
    );
    expect(paperSheet).toMatch(
      /\.paper-sheet \{[\s\S]*box-shadow:\s*var\(--paper-sheet-shadow,\s*var\(--sheet-shadow\)\)/,
    );
    expect(paperSheet).toMatch(/\.paper-sheet \{[\s\S]*height:\s*fit-content/);
    expect(paperSheet).toMatch(
      /\.paper-sheet \{[\s\S]*min-height:\s*var\(--paper-sheet-min-height,\s*auto\)/,
    );
    expect(styles).toMatch(/--paper-sheet-bg:\s*oklch\(1 0 0\)/);
    expect(styles).toMatch(/--sheet-shadow:\s*0 1px 2px #0000000a,\s*0 10px 30px -10px #0f172a1f/);
    expect(css).toMatch(
      /\.note-detail-view\.paper-sheet \{[\s\S]*@apply mx-auto w-full max-w-\[680px\] px-4 py-8 md:px-6 md:py-10;/,
    );
    expect(css).not.toMatch(/\.note-detail-view\.paper-sheet \{[\s\S]*\bpx-6 py-8 md:px-10\b/);
    expect(css).not.toMatch(/\.note-detail-view\.paper-sheet \{[\s\S]*min-h-full/);
    expect(css).not.toMatch(/\.note-detail-view\.paper-sheet \{[\s\S]*min-height:\s*100%/);
    expect(css).toMatch(/Notes-workspace sets `--paper-sheet-min-height`/);
    expect(css).toMatch(/overflow scrolls on[\s/*]+`\.workspace-detail-pane__scroll`/);
    expect(css).toMatch(/so the same calc is `100%`/);
  });

  it("paints title from the sheet contrast token", () => {
    expect(css).toMatch(
      /\.note-detail-view__title \{[\s\S]*color:\s*var\(--notes-detail-contrast-fg,\s*var\(--color-ink\)\)/,
    );
    expect(css).toMatch(/\.note-detail-view__title \{[\s\S]*text-box:\s*normal;/);
    expect(css).toMatch(/\.note-detail-view__title \{[\s\S]*text-box-trim:\s*none;/);
  });

  it("does not invent decorative sheet chrome", () => {
    expect(css).not.toMatch(/traffic-light|riviera|note-detail-sheet__handle/i);
  });
});

describe("note-detail-view title CSS", () => {
  it("sizes SUMMARY as a document title, not a form input", () => {
    expect(css).toMatch(/\.note-detail-view__title \{[\s\S]*text-4xl/);
    expect(css).not.toMatch(/\.note-detail-view__title \{[\s\S]*text-3xl/);
    expect(css).not.toMatch(/\.note-detail-view__title \{[\s\S]*text-sm\b/);
    expect(styles).toMatch(/textarea:not\(\.note-detail-view__title\)/);
    expect(styles).toMatch(/:not\(\.note-detail-view__title\)/);
  });

  it("keeps serif descenders visible", () => {
    expect(css).toMatch(/\.note-detail-view__title \{[\s\S]*text-box:\s*normal;/);
    expect(css).toMatch(/\.note-detail-view__title \{[\s\S]*text-box-trim:\s*none;/);
    expect(css).toMatch(/\.note-detail-view__title \{[\s\S]*overflow:\s*visible\s*!important/);
    expect(css).not.toMatch(/\.note-detail-view__title \{[\s\S]*overflow-hidden/);
    expect(css).not.toMatch(/\.note-detail-view__title \{[\s\S]*line-clamp/);
  });

  it("wraps long titles instead of truncating to one line", () => {
    expect(css).toMatch(/\.note-detail-view__title \{[\s\S]*whitespace-pre-wrap/);
    expect(css).toMatch(/\.note-detail-view__title \{[\s\S]*break-words/);
    expect(css).toMatch(/\.note-detail-view__title \{[\s\S]*resize-none/);
    expect(css).not.toMatch(/\.note-detail-view__title \{[\s\S]*truncate/);
    expect(css).not.toMatch(/\.note-detail-view__title \{[\s\S]*whitespace-nowrap/);
    expect(css).not.toMatch(/\.note-detail-view__title \{[\s\S]*text-ellipsis/);
  });

  it("keeps the sheet title at least as large as body h1", () => {
    const titleRem = 2.25;
    const multipliers = [1, 2, 3, 4, 5, 6].map((level) => {
      const match = css.match(
        new RegExp(`--text-editor-prose-heading-h${level}-size:\\s*([\\d.]+)`),
      );
      expect(match, `missing h${level} token`).toBeTruthy();
      return Number(match![1]);
    });
    expect(titleRem).toBeGreaterThanOrEqual(multipliers[0]!);
    for (let i = 1; i < multipliers.length; i++) {
      expect(multipliers[i]!).toBeLessThan(multipliers[i - 1]!);
    }
  });

  it("keeps the title label visually hidden", () => {
    expect(css).toMatch(/\.note-detail-view__title-label \{[\s\S]*sr-only/);
  });

  it("keeps a modest gap between title, tags, and body", () => {
    expect(css).toMatch(/\.note-detail-view__title \{[\s\S]*@apply mb-3\.5 /);
    expect(css).toMatch(/\.note-detail-view__tag-group \{[\s\S]*@apply mb-5 py-5/);
    expect(css).not.toMatch(/@apply mb-3 /);
    expect(css).not.toMatch(/@apply mb-4 py-4/);
    expect(css).not.toMatch(/py-6 mb-6/);
  });
});
