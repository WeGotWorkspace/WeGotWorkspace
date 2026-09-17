import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "app-switch-button.css"), "utf8");

describe("app switch button lockup alignment", () => {
  it("top-aligns the icon mark with the label", () => {
    expect(css).toMatch(/\.app-switch-button__trigger \{[^}]*@apply[^;]*\bitems-start\b/);
    expect(css).toMatch(/\.app-switch-button__trigger--compact \{[^}]*@apply[^;]*\bitems-start\b/);
    expect(css).not.toMatch(/\.app-switch-button__trigger \{[^}]*@apply[^;]*\bitems-center\b/);
  });

  it("keeps lockup leading after text-3xl so icon height matches two caption lines", () => {
    expect(css).toMatch(
      /\.app-switch-button__label \{[^}]*@apply[^;]*\btext-3xl\b[^;]*leading-\[0\.85\]/,
    );
  });

  it("appends an inline typographic chevron after the app name (not a separate icon stack)", () => {
    expect(css).not.toMatch(/\.app-switch-button__chevron-stack/);
    expect(css).toMatch(/\.app-switch-button__chevron \{[^}]*@apply[^;]*\binline-block\b/);
    expect(css).toMatch(/\.app-switch-button__label-name \{[^}]*items-baseline/);
  });
});
