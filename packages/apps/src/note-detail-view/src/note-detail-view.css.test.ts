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
    expect(css).toMatch(/\.note-detail-view__title \{[\s\S]*text-box:\s*auto;/);
  });

  it("does not invent decorative sheet chrome", () => {
    expect(css).not.toMatch(/traffic-light|riviera|note-detail-sheet__handle/i);
  });
});

describe("note-detail-view title CSS", () => {
  it("sizes SUMMARY as a document title, not a form input", () => {
    expect(css).toMatch(/\.note-detail-view__title \{[\s\S]*text-3xl/);
    expect(css).toMatch(/\.note-detail-view__title \{[\s\S]*md:text-4xl/);
    expect(css).not.toMatch(/\.note-detail-view__title \{[\s\S]*text-sm\b/);
    expect(styles).toMatch(/:not\(\.note-detail-view__title\)/);
  });

  it("trims title leading with text-box: auto", () => {
    expect(css).toMatch(/\.note-detail-view__title \{[\s\S]*text-box:\s*auto;/);
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
