import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "app-switch-button.css"), "utf8");
const brandLockupTsx = readFileSync(join(here, "../../brand-lockup/src/brand-lockup.tsx"), "utf8");
const brandLockupCss = readFileSync(join(here, "../../brand-lockup/src/brand-lockup.css"), "utf8");

describe("app switch button lockup alignment", () => {
  it("top-aligns the icon mark with the label", () => {
    expect(css).toMatch(/\.app-switch-button__trigger \{[^}]*@apply[^;]*\bitems-start\b/);
    expect(css).toMatch(/\.app-switch-button__trigger--compact \{[^}]*@apply[^;]*\bitems-start\b/);
    expect(css).not.toMatch(/\.app-switch-button__trigger \{[^}]*@apply[^;]*\bitems-center\b/);
  });

  it("pins lockup leading to a shared token so icon height matches two caption lines", () => {
    expect(css).toMatch(
      /\.app-switch-button__trigger \{[\s\S]*?--app-switch-lockup-leading:\s*0\.85/,
    );
    expect(css).toMatch(
      /--app-switch-lockup-line:\s*calc\(1\.875rem \* var\(--app-switch-lockup-leading\)\)/,
    );
    expect(css).toMatch(
      /\.app-switch-button__label \{[\s\S]*?line-height:\s*var\(--app-switch-lockup-leading/,
    );
    expect(css).toMatch(
      /\.app-switch-button__label-top,\s*\.app-switch-button__label-name \{[\s\S]*?line-height:\s*inherit/,
    );
    expect(css).not.toMatch(/\.app-switch-button__label \{[^}]*leading-\[/);
  });

  it("shares the same label leading with BrandLockup (single CSS source)", () => {
    expect(brandLockupTsx).toMatch(/@\/app-switch-button\/src\/app-switch-button\.css/);
    expect(brandLockupTsx).toMatch(/app-switch-button__label/);
    expect(brandLockupTsx).toMatch(/app-switch-button__label-top/);
    expect(brandLockupTsx).toMatch(/app-switch-button__label-name/);
    expect(brandLockupCss).not.toMatch(/leading-\[/);
    expect(brandLockupCss).not.toMatch(/line-height/);
    expect(brandLockupCss).not.toMatch(/font-family/);
    expect(brandLockupCss).not.toMatch(/\.app-switch-button__label\b/);
  });

  it("pins the lockup face to --font-mark (Bebas), not product sans", () => {
    expect(css).toMatch(
      /\.app-switch-button__label \{[\s\S]*?@apply[^;]*\btext-lockup\b[\s\S]*?font-family:\s*var\(--font-mark\)/,
    );
    expect(css).not.toMatch(/\.app-switch-button__label \{[^}]*font-family:\s*var\(--font-sans\)/);
    expect(css).not.toMatch(/\.app-switch-button__label \{[^}]*font-family:\s*var\(--font-app\)/);
    expect(css).not.toMatch(/\.app-switch-button__label \{[^}]*font-family:\s*ui-sans-serif/);
  });

  it("keeps the chevron out of the subtitle line box so leading matches BrandLockup", () => {
    expect(css).not.toMatch(/\.app-switch-button__chevron-stack/);
    expect(css).not.toMatch(/\.app-switch-button__label-name \{[^}]*@apply[^;]*\binline-flex\b/);
    expect(css).not.toMatch(/\.app-switch-button__label-name \{[^}]*@apply[^;]*\bitems-baseline\b/);
    expect(css).toMatch(
      /\.app-switch-button__label-name \{[^}]*@apply[^;]*\brelative\b[^;]*\bblock\b/,
    );
    expect(css).toMatch(/\.app-switch-button__chevron \{[^}]*@apply[^;]*\babsolute\b/);
    expect(css).not.toMatch(/\.app-switch-button__chevron \{[^}]*@apply[^;]*\binline-block\b/);
    expect(css).not.toMatch(/\.app-switch-button__chevron \{[^}]*@apply[^;]*\binline-flex\b/);
  });
});
