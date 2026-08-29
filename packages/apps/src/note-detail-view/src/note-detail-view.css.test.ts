import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "note-detail-view.css"), "utf8");
const styles = readFileSync(join(here, "../../styles.css"), "utf8");

describe("note-detail-view title CSS", () => {
  it("sizes SUMMARY as a document title, not a form input", () => {
    expect(css).toMatch(/\.note-detail-view__title \{[\s\S]*text-3xl/);
    expect(css).toMatch(/\.note-detail-view__title \{[\s\S]*md:text-4xl/);
    expect(css).not.toMatch(/\.note-detail-view__title \{[\s\S]*text-sm\b/);
    expect(styles).toMatch(/:not\(\.note-detail-view__title\)/);
  });

  it("keeps the title label visually hidden", () => {
    expect(css).toMatch(/\.note-detail-view__title-label \{[\s\S]*sr-only/);
  });
});
