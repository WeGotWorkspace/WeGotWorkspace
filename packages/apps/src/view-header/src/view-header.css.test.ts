import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "view-header.css"), "utf8");

describe("view-header CSS", () => {
  it("wraps stacked and narrow responsive titles instead of ellipsizing first", () => {
    expect(css).toMatch(
      /\.view-header__title-row--stacked \.view-header__title \{[\s\S]*whitespace-normal/,
    );
    expect(css).toMatch(
      /\.view-header__title-row--responsive \.view-header__title \{[\s\S]*whitespace-normal/,
    );
    expect(css).toMatch(/@container view-header-main \(max-width: 40rem\)/);
    expect(css).toMatch(/@supports not \(container-type: inline-size\)/);
  });

  it("uses medium-weight sans for the canonical title", () => {
    expect(css).toMatch(
      /\.view-header__title \{[\s\S]*text-sm font-medium leading-none md:text-lg/,
    );
    expect(css).toMatch(/\.view-header__title \{[\s\S]*font-family:\s*var\(--font-sans\)/);
    expect(css).not.toMatch(/\.view-header__title \{[\s\S]*font-family:\s*var\(--font-serif\)/);
    expect(css).not.toMatch(/\.view-header__title--sm/);
    expect(css).not.toMatch(
      /@container view-header-main \(max-width: 40rem\)[\s\S]*\.view-header__title:not\(/,
    );
  });

  it("aligns the title with the sidebar toggle and swaps compact titles", () => {
    expect(css).toMatch(/\.view-header \{[\s\S]*items-center/);
    expect(css).toMatch(/\.view-header__title-cluster \{[\s\S]*items-center gap-2/);
    expect(css).toMatch(/\.view-header__title-compact \{[\s\S]*hidden/);
  });

  it("does not define a subtitle slot", () => {
    expect(css).not.toMatch(/\.view-header__subtitle/);
  });

  it("styles title-count text to match the title typography, not a Badge", () => {
    expect(css).toMatch(
      /\.view-header__title-count \{[\s\S]*text-sm font-medium leading-none md:text-lg/,
    );
    expect(css).toMatch(/\.view-header__title-count \{[\s\S]*font-family:\s*var\(--font-sans\)/);
    expect(css).toMatch(/\.view-header__title-count \{[\s\S]*color:\s*var\(--color-ink\)/);
    expect(css).not.toMatch(/\.view-header__title-suffix \.badge/);
  });

  it("puts view actions and titleTrailing on row 1, title and prev/next on row 2", () => {
    expect(css).not.toMatch(/--view-header-leading-order:\s*1/);
    expect(css).toMatch(
      /\.view-header__title-row--stacked \{[\s\S]*"actions trailing"[\s\S]*"title leading"/,
    );
    expect(css).toMatch(
      /\.view-header__title-row--stacked \.view-header__end,[\s\S]*\.view-header__title-cluster \{[\s\S]*display: contents/,
    );
    expect(css).toMatch(
      /\.view-header__title-row--stacked \.view-header__title-block \{[\s\S]*grid-area: title/,
    );
    expect(css).toMatch(
      /\.view-header__title-row--stacked \.view-header__title-leading \{[\s\S]*grid-area: leading/,
    );
    expect(css).toMatch(
      /\.view-header__title-row--stacked \.view-header__title-trailing \{[\s\S]*grid-area: trailing/,
    );
    expect(css).toMatch(
      /@container view-header-main \(max-width: 40rem\)[\s\S]*\.view-header__title-row--responsive \{[\s\S]*"actions trailing"/,
    );
  });
});
