import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "installer.css"), "utf8");

describe("installer CSS", () => {
  it("uses ink chrome and brand-green active fills on the cream auth shell", () => {
    expect(css).toMatch(/\.installer \{[\s\S]*?--button-active-color:\s*#003311/);
    expect(css).toMatch(/\.installer \{[\s\S]*?--segmented-control-active-bg:\s*#003311/);
    expect(css).toMatch(/\.installer \{[\s\S]*?--segmented-control-active-fg:\s*#ffffff/);
    expect(css).toMatch(/\.installer \{[\s\S]*?--segmented-control-color:\s*var\(--color-ink\)/);
    expect(css).not.toMatch(/--button-active-color:\s*var\(--workspace-home-bg/);
    expect(css).not.toMatch(/--segmented-control-active-fg:\s*var\(--workspace-home-bg/);
    expect(css).not.toMatch(/--segmented-control-color:\s*#ffffff/);
    expect(css).toMatch(
      /\.installer__dot--current,\s*\.installer__dot--done \{[\s\S]*?background-color:\s*var\(--color-ink/,
    );
    expect(css).toMatch(
      /\.installer__lead \{[\s\S]*?color:\s*color-mix\(in oklab,\s*var\(--color-ink/,
    );
    expect(css).not.toMatch(/\.installer__check-label \{[\s\S]*text-white/);
  });

  it("splits the hero into italic Your and sans-serif 600 noun", () => {
    expect(css).toMatch(/\.installer__hero-your \{[\s\S]*@apply italic/);
    expect(css).toMatch(
      /\.installer__hero-noun \{[\s\S]*@apply font-sans font-semibold not-italic/,
    );
  });

  it("groups a field hint tightly under its control", () => {
    expect(css).toMatch(/\.installer__field \{[\s\S]*@apply mb-3/);
    expect(css).toMatch(/\.installer__field \.field-label-row \{[\s\S]*@apply mb-0/);
    expect(css).toMatch(/\.installer__field \.installer__hint \{[\s\S]*@apply mb-0 mt-1\.5/);
  });

  it("animates field feedback height open and closed without a reserved band", () => {
    expect(css).toMatch(/\.installer__field-feedback \{[^}]*interpolate-size:\s*allow-keywords/);
    expect(css).toMatch(/\.installer__field-feedback \{[^}]*overflow:\s*hidden/);
    expect(css).toMatch(/\.installer__field-feedback \{[^}]*height:\s*auto/);
    expect(css).toMatch(/\.installer__field-feedback \{[^}]*transition:[^}]*height 200ms ease/);
    expect(css).toMatch(/\.installer__field-feedback--hidden \{[^}]*height:\s*0/);
    expect(css).toMatch(/\.installer__field-feedback--hidden \{[^}]*opacity:\s*0/);
    expect(css).toMatch(/\.installer__field-feedback--hidden \{[^}]*pointer-events:\s*none/);
    expect(css).not.toMatch(/\.installer__field-feedback \{[\s\S]*min-h-10/);
    expect(css).toMatch(
      /prefers-reduced-motion:\s*reduce[\s\S]*\.installer__field-feedback \{[^}]*transition:\s*none/,
    );
  });

  it("aligns interrupt check icons to the first line of the label", () => {
    expect(css).toMatch(/\.installer__check \{[\s\S]*@apply flex items-start/);
    expect(css).toMatch(/\.installer__check-icon \{[\s\S]*@apply mt-0\.5 shrink-0/);
  });

  it("animates one engine panel height with interpolate-size, not a grid stack", () => {
    expect(css).toMatch(/\.installer__engine-panels \{[^}]*interpolate-size:\s*allow-keywords/);
    expect(css).toMatch(/\.installer__engine-panel \{[^}]*overflow:\s*hidden/);
    expect(css).toMatch(/\.installer__engine-panel \{[^}]*height:\s*auto/);
    expect(css).toMatch(/\.installer__engine-panel \{[^}]*transition:[^}]*height 200ms ease/);
    expect(css).toMatch(/\.installer__engine-panel--hidden \{[^}]*height:\s*0/);
    expect(css).toMatch(/\.installer__engine-panel--hidden \{[^}]*opacity:\s*0/);
    expect(css).toMatch(/\.installer__engine-panel--hidden \{[^}]*pointer-events:\s*none/);
    expect(css).not.toMatch(/\.installer__engine-panel \{[^}]*grid-area:\s*1 \/ 1/);
    expect(css).not.toMatch(/\.installer__engine-panels \{[^}]*@apply grid/);
    expect(css).not.toMatch(/\.installer__engine-panel \{[^}]*@apply visible/);
    expect(css).not.toMatch(/\.installer__engine-panel--hidden \{[^}]*@apply invisible/);
    expect(css).not.toMatch(/\.installer__engine-panel--hidden \{[^}]*display:\s*none/);
    expect(css).toMatch(
      /prefers-reduced-motion:\s*reduce[\s\S]*\.installer__engine-panel \{[^}]*transition:\s*none/,
    );
  });
});
