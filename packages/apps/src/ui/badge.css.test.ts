import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "badge.css"), "utf8");
const tsx = readFileSync(join(here, "badge.tsx"), "utf8");

describe("Badge accent variant", () => {
  it("exposes an accent variant that inherits outline-active wash tokens", () => {
    expect(tsx).toMatch(/accent:\s*"badge--variant-accent"/);
    expect(css).toMatch(/\.badge\.badge--variant-accent \{/);
    expect(css).toMatch(/--button-outline-active-background/);
    expect(css).toMatch(/--button-active-color/);
  });

  it("uses the quiet outline-active control stroke, not a transparent border", () => {
    expect(css).toMatch(
      /\.badge\.badge--variant-accent \{[\s\S]*border-color:\s*var\(\s*--button-outline-active-border-color,\s*var\(--button-outline-border-color,\s*var\(--control-border-color\)\)/,
    );
    expect(css).not.toMatch(/\.badge\.badge--variant-accent \{[\s\S]*border-color:\s*transparent/);
  });

  it("uses AA-safe active fg (accent-strong via --button-active-color), not raw workspace accent", () => {
    expect(css).toMatch(
      /\.badge\.badge--variant-accent \{[\s\S]*color:\s*var\(--button-active-color,\s*var\(--color-ink\)\)/,
    );
    const accentBlock = css.match(/\.badge\.badge--variant-accent \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(accentBlock).not.toMatch(
      /color:\s*var\(--button-active-color,\s*var\(--workspace-accent/,
    );
  });

  it("keeps hover on the same accent wash language", () => {
    expect(css).toMatch(
      /\.badge\.badge--variant-accent:hover \{[\s\S]*--button-outline-active-hover-background/,
    );
  });
});
