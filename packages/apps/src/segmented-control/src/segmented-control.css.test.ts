import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "segmented-control.css"), "utf8");

describe("segmented-control chrome tokens", () => {
  it("inherits track radius from global --control-radius", () => {
    expect(css).toMatch(
      /\.segmented-control \{[\s\S]*--segmented-control-track-radius:\s*var\(--control-radius\)/,
    );
    expect(css).toMatch(
      /\.segmented-control \{[\s\S]*border-radius:\s*var\(--segmented-control-track-radius\)/,
    );
    expect(css).not.toMatch(
      /--segmented-control-track-radius:\s*var\(--control-radius-button-pill\)/,
    );
  });

  it("keeps the thumb on the inner track curve (track radius − border, floored at 0)", () => {
    expect(css).toMatch(
      /--segmented-control-thumb-radius:\s*max\(\s*0px,\s*calc\(\s*var\(--segmented-control-track-radius\)\s*-\s*var\(--segmented-control-track-border-width\)\s*\)\s*\)/,
    );
    expect(css).not.toMatch(
      /--segmented-control-thumb-radius:\s*var\(--segmented-control-track-radius\)\s*;/,
    );
    expect(css).toMatch(
      /\.segmented-control__thumb \{[\s\S]*border-radius:\s*var\(--segmented-control-thumb-radius\)/,
    );
  });

  it("defaults the track to transparent with outline/control border", () => {
    expect(css).toMatch(
      /\.segmented-control \{[\s\S]*background-color:\s*var\(--segmented-control-track-bg,\s*transparent\)/,
    );
    expect(css).toMatch(
      /\.segmented-control \{[\s\S]*border:\s*var\(--segmented-control-track-border-width\)\s+solid\s+var\(\s*--segmented-control-track-border-color,\s*var\(--button-outline-border-color,\s*var\(--control-border-color\)\)/,
    );
  });

  it("clips the selected thumb inside the track (overflow hidden, flush, no Switch gutter)", () => {
    expect(css).not.toMatch(/--segmented-control-padding:/);
    expect(css).toMatch(/\.segmented-control \{[\s\S]*padding:\s*0/);
    expect(css).toMatch(/\.segmented-control \{[\s\S]*items-stretch/);
    expect(css).toMatch(/\.segmented-control \{[\s\S]*overflow-hidden/);
    expect(css).toMatch(/\.segmented-control__button \{[\s\S]*height:\s*100%/);
    expect(css).toMatch(/\.segmented-control__button \{[\s\S]*aspect-ratio:\s*1\s*\/\s*1/);
    expect(css).toMatch(/\.segmented-control__thumb \{[\s\S]*top:\s*0/);
    expect(css).toMatch(/\.segmented-control__thumb \{[\s\S]*bottom:\s*0/);
    expect(css).toMatch(/\.segmented-control__thumb \{[\s\S]*height:\s*auto/);
    expect(css).toMatch(
      /\.segmented-control__thumb \{[\s\S]*width:\s*var\(--segmented-control-thumb-width,\s*0px\)/,
    );
    expect(css).toMatch(
      /\.segmented-control__thumb \{[\s\S]*transform:\s*translateX\(var\(--segmented-control-thumb-x,\s*0px\)\)/,
    );
    expect(css).toMatch(/\.segmented-control__thumb \{[\s\S]*border:\s*0/);
    expect(css).toMatch(
      /\.segmented-control__thumb \{[\s\S]*border-radius:\s*var\(--segmented-control-thumb-radius\)/,
    );
    expect(css).toMatch(/\.segmented-control__thumb \{[\s\S]*z-index:\s*1/);
    expect(css).not.toMatch(
      /height:\s*calc\(100%\s*\+\s*2\s*\*\s*var\(--segmented-control-track-border-width\)\)/,
    );
  });

  it("uses auto aspect-ratio and inline gap for labeled segments", () => {
    expect(css).toMatch(
      /\.segmented-control__button--text \{[\s\S]*@apply gap-1;[\s\S]*aspect-ratio:\s*auto/,
    );
  });

  it("parks the sliding thumb without an off-screen translate when unselected", () => {
    expect(css).toMatch(
      /\.segmented-control--unselected \.segmented-control__thumb \{[\s\S]*@apply invisible opacity-0/,
    );
    expect(css).not.toMatch(
      /\.segmented-control--unselected \.segmented-control__thumb \{[\s\S]*-translate-x-full/,
    );
  });

  it("animates thumb transform only after data-thumb-animate; reduced-motion disables", () => {
    expect(css).toMatch(/\.segmented-control__thumb \{[\s\S]*transition:[\s\S]*transform 200ms/);
    expect(css).not.toMatch(/\.segmented-control__thumb \{[\s\S]*transition:[\s\S]*width 200ms/);
    expect(css).toMatch(
      /\.segmented-control:not\(\[data-thumb-animate\]\) \.segmented-control__thumb \{[\s\S]*transition:\s*none/,
    );
    expect(css).toMatch(
      /@media \(prefers-reduced-motion:\s*reduce\) \{[\s\S]*\.segmented-control__thumb[\s\S]*transition:\s*none/,
    );
  });

  it("tints the active thumb via wash/glyph tokens (active background preferred)", () => {
    expect(css).toMatch(
      /\.segmented-control__thumb \{[\s\S]*background-color:\s*var\(\s*--segmented-control-active-bg,\s*var\(\s*--button-outline-active-background/,
    );
    expect(css).toMatch(
      /\.segmented-control__button--active \{[\s\S]*color:\s*var\(\s*--segmented-control-active-fg,\s*var\(--button-active-color,\s*var\(--color-ink\)\)/,
    );
    expect(css).toMatch(
      /\.segmented-control__thumb \{[\s\S]*box-shadow:\s*var\(--segmented-control-active-shadow,\s*none\)/,
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

  it("uses keyboard-only focus rings on the track (not cropped by overflow)", () => {
    expect(css).toMatch(
      /\.segmented-control:has\(\.segmented-control__button:focus-visible\) \{[\s\S]*ring-1 ring-ring/,
    );
    expect(css).toMatch(/\.segmented-control__button \{[\s\S]*focus-visible:outline-none/);
    expect(css).not.toMatch(/\.segmented-control__button \{[\s\S]*\bfocus:ring-/);
    expect(css).not.toMatch(/\.segmented-control__button \{[\s\S]*focus-visible:ring-1/);
  });

  it("hovers non-disabled segments via outline hover tokens", () => {
    expect(css).toMatch(
      /\.segmented-control__button:hover:not\(:disabled\) \{[\s\S]*color:\s*var\(\s*--segmented-control-hover-color,\s*var\(--button-outline-hover-color/,
    );
    expect(css).toMatch(
      /\.segmented-control__button:hover:not\(:disabled\) \{[\s\S]*background-color:\s*var\(\s*--segmented-control-hover-bg,\s*var\(--button-outline-hover-background/,
    );
    expect(css).toMatch(
      /\.segmented-control__button--active:hover:not\(:disabled\) \{[\s\S]*background-color:\s*transparent/,
    );
  });

  it("washes success/danger on selected thumb only (not idle hover), using ghost mix not emerald", () => {
    expect(css).toMatch(
      /--segmented-control-severity-success-color:\s*var\(\s*--button-severity-success-color,\s*color-mix\(in oklab,\s*var\(--color-ghost/,
    );
    expect(css).not.toMatch(/--segmented-control-severity-success[\s\S]*--color-emerald/);
    expect(css).not.toMatch(
      /\.segmented-control__button--severity-success:hover:not\(:disabled\) \{[\s\S]*background-color:\s*var\(--segmented-control-severity-success-hover-bg\)/,
    );
    expect(css).not.toMatch(
      /\.segmented-control__button--severity-danger:hover:not\(:disabled\) \{[\s\S]*background-color:\s*var\(--segmented-control-severity-danger-hover-bg\)/,
    );
    expect(css).toMatch(
      /\.segmented-control__thumb--severity-success \{[\s\S]*background-color:\s*var\(--segmented-control-severity-success-hover-bg\)/,
    );
    expect(css).toMatch(
      /\.segmented-control__thumb--severity-danger \{[\s\S]*background-color:\s*var\(--segmented-control-severity-danger-hover-bg\)/,
    );
  });

  it("resets button padding and kills line-box strut for vertical centering", () => {
    expect(css).toMatch(/\.segmented-control__button \{[\s\S]*border-0 p-0/);
    expect(css).toMatch(/\.segmented-control__button \{[\s\S]*line-height:\s*0/);
    expect(css).toMatch(/\.segmented-control__button svg \{[\s\S]*@apply block shrink-0/);
    expect(css).toMatch(/\.segmented-control__label \{[\s\S]*line-height:\s*1/);
  });
});
