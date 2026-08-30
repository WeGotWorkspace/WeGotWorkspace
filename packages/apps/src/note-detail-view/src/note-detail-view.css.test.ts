import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "note-detail-view.css"), "utf8");
const styles = readFileSync(join(here, "../../styles.css"), "utf8");

describe("note-detail-view paper sheet CSS", () => {
  it("styles the open note as a paper card", () => {
    expect(css).toMatch(/\.note-detail-sheet \{[\s\S]*rounded-none/);
    expect(css).not.toMatch(/\.note-detail-sheet \{[\s\S]*rounded-2xl/);
    expect(css).toMatch(/\.note-detail-sheet \{[\s\S]*--note-detail-sheet-bg/);
    expect(css).toMatch(
      /\.note-detail-sheet \{[\s\S]*0 1px 1px color-mix\(in oklab,\s*var\(--color-ink\) 22%/,
    );
    expect(css).toMatch(/\.note-detail-sheet \{[\s\S]*0 3px 6px/);
    expect(css).toMatch(/\.note-detail-sheet \{[\s\S]*0 12px 20px -4px/);
    expect(css).toMatch(/\.note-detail-sheet \{[\s\S]*0 32px 48px -12px/);
    expect(css).toMatch(/\.note-detail-sheet \{[\s\S]*px-6/);
    expect(css).toMatch(/\.note-detail-sheet \{[\s\S]*md:px-10/);
    expect(css).toMatch(/\.note-detail-sheet \{[\s\S]*md:py-10/);
    expect(css).toMatch(/\.note-detail-sheet \{[\s\S]*min-h-full/);
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
    expect(css).toMatch(/\.note-detail-view__title \{[\s\S]*overflow-visible/);
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
