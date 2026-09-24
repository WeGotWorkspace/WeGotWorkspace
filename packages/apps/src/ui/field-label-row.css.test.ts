import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "field-label-row.css"), "utf8");

describe("field-label-row CSS", () => {
  it("uses shared text-caption (sans, medium, uppercase) for labels", () => {
    expect(css).toMatch(/\.field-label-row__label \{[\s\S]*@apply[\s\S]*\btext-caption\b/);
    expect(css).toMatch(
      /\.field-label-row__label \{[\s\S]*font-family:\s*var\(\s*--field-label-font-family,\s*var\(\s*--font-sans/,
    );
    expect(css).not.toMatch(
      /\.field-label-row__label \{[\s\S]*font-family:\s*var\(\s*--field-label-font-family,\s*var\(\s*--font-mono/,
    );
  });

  it("uses text-caption without letter-spacing and scales sibling icons", () => {
    expect(css).toMatch(/\.field-label-row__label \{[\s\S]*@apply[\s\S]*\btext-caption\b/);
    expect(css).not.toMatch(/\.field-label-row__label \{[\s\S]*@apply[\s\S]*\btracking-/);
    expect(css).toMatch(/\.field-label-row__label > svg \{[\s\S]*@apply size-3/);
    expect(css).toMatch(/\.field-label-row__lock \{[\s\S]*@apply size-3/);
  });

  it("reserves the caption band without collapsing or using column flex-basis", () => {
    expect(css).toMatch(/\.field-label-row__label--reserved \{[\s\S]*@apply invisible/);
    expect(css).not.toMatch(/\.field-label-row__label--reserved \{[\s\S]*display:\s*none/);
    expect(css).not.toMatch(/flex-basis:\s*(?!auto\b)\S+/);
  });

  it("lays out icon mode as a horizontal icon-then-control row", () => {
    expect(css).toMatch(/\.field-label-row--icon \{[\s\S]*@apply[\s\S]*\bflex\b/);
    expect(css).toMatch(/\.field-label-row__icon-label \{[\s\S]*min-height:/);
    expect(css).toMatch(/\.field-label-row__icon-label > svg \{[\s\S]*@apply size-3/);
    expect(css).toMatch(/\.field-label-row__control \{[\s\S]*@apply min-w-0 flex-1/);
  });
});
