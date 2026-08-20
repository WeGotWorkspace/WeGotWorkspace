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

  it("keeps the large title on wide headers and shrinks it only when compact", () => {
    expect(css).toMatch(/\.view-header__title \{[\s\S]*text-2xl leading-none/);
    expect(css).toMatch(/\.view-header__title \{[\s\S]*text-box:\s*auto;/);
    expect(css).toMatch(
      /@container view-header-main \(max-width: 40rem\)[\s\S]*\.view-header__title:not\(\.view-header__title--sm\) \{[\s\S]*text-xl/,
    );
  });

  it("aligns the title with the sidebar toggle and swaps compact titles", () => {
    expect(css).toMatch(/\.view-header \{[\s\S]*items-start/);
    expect(css).toMatch(/\.view-header__title-cluster \{[\s\S]*items-center gap-2/);
    expect(css).toMatch(/\.view-header__title-compact \{[\s\S]*hidden/);
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
