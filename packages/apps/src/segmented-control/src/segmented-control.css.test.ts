import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "segmented-control.css"), "utf8");

describe("segmented-control chrome tokens", () => {
  it("defaults the track to transparent with outline/control border", () => {
    expect(css).toMatch(
      /\.segmented-control \{[\s\S]*background-color:\s*var\(--segmented-control-track-bg,\s*transparent\)/,
    );
    expect(css).toMatch(
      /\.segmented-control \{[\s\S]*border:\s*var\(--segmented-control-track-border-width\)\s+solid\s+var\(\s*--segmented-control-track-border-color,\s*var\(--button-outline-border-color,\s*var\(--control-border-color\)\)/,
    );
  });

  it("fills thumbs flush and lets the active thumb overlap the track stroke", () => {
    expect(css).toMatch(/--segmented-control-padding:\s*0px/);
    expect(css).toMatch(/\.segmented-control \{[\s\S]*items-stretch/);
    expect(css).not.toMatch(/overflow-hidden/);
    expect(css).toMatch(/\.segmented-control__button \{[\s\S]*height:\s*100%/);
    expect(css).toMatch(/\.segmented-control__button \{[\s\S]*aspect-ratio:\s*1\s*\/\s*1/);
    expect(css).toMatch(
      /\.segmented-control__button--active \{[\s\S]*height:\s*calc\(100%\s*\+\s*2\s*\*\s*var\(--segmented-control-track-border-width\)\)/,
    );
    expect(css).toMatch(
      /\.segmented-control__button--active \{[\s\S]*margin:\s*calc\(-1\s*\*\s*var\(--segmented-control-track-border-width\)\)/,
    );
    expect(css).toMatch(
      /\.segmented-control__button--active \{[\s\S]*border:\s*var\(--segmented-control-track-border-width\)\s+solid\s+var\(\s*--segmented-control-active-border-color,\s*var\(--button-outline-border-color,\s*var\(--control-border-color\)\)/,
    );
    expect(css).toMatch(/\.segmented-control__button--active \{[\s\S]*z-index:\s*1/);
  });

  it("tints the active segment via wash/glyph tokens", () => {
    expect(css).toMatch(
      /\.segmented-control__button--active \{[\s\S]*background-color:\s*var\(\s*--segmented-control-active-bg,\s*var\(\s*--button-outline-hover-background/,
    );
    expect(css).toMatch(
      /\.segmented-control__button--active \{[\s\S]*color:\s*var\(\s*--segmented-control-active-fg,\s*var\(--button-active-color,\s*var\(--color-ink\)\)/,
    );
    expect(css).toMatch(
      /\.segmented-control__button--active \{[\s\S]*box-shadow:\s*var\(--segmented-control-active-shadow,\s*none\)/,
    );
  });

  it("matches idle segment foreground to outline button color (no muted fade)", () => {
    expect(css).toMatch(
      /\.segmented-control__button \{[\s\S]*color:\s*var\(\s*--segmented-control-color,\s*var\(--button-outline-color,\s*var\(--color-ink\)\)/,
    );
    expect(css).not.toMatch(
      /color-mix\(in oklab,\s*var\(--segmented-control-color,\s*var\(--color-ink\)\)\s*55%/,
    );
  });

  it("uses keyboard-only focus rings on segments", () => {
    expect(css).toMatch(
      /\.segmented-control__button \{[\s\S]*focus-visible:ring-1 focus-visible:ring-ring/,
    );
    expect(css).not.toMatch(/\.segmented-control__button \{[\s\S]*\bfocus:ring-/);
  });

  it("hovers non-disabled segments via outline hover tokens", () => {
    expect(css).toMatch(
      /\.segmented-control__button:hover:not\(:disabled\) \{[\s\S]*color:\s*var\(\s*--segmented-control-hover-color,\s*var\(--button-outline-hover-color/,
    );
    expect(css).toMatch(
      /\.segmented-control__button:hover:not\(:disabled\) \{[\s\S]*background-color:\s*var\(\s*--segmented-control-hover-bg,\s*var\(\s*--button-outline-hover-background/,
    );
    expect(css).toMatch(
      /\.segmented-control__button--active:hover:not\(:disabled\) \{[\s\S]*background-color:\s*var\(\s*--segmented-control-active-hover-bg,\s*var\(\s*--segmented-control-active-bg/,
    );
  });
});
