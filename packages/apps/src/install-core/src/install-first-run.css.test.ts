import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "install-first-run.css"), "utf8");

describe("install-first-run CSS", () => {
  it("splits the hero into italic Your and sans-serif 600 noun", () => {
    expect(css).toMatch(/\.install-first-run__hero-your \{[\s\S]*@apply italic/);
    expect(css).toMatch(
      /\.install-first-run__hero-noun \{[\s\S]*@apply font-sans font-semibold not-italic/,
    );
  });

  it("groups a field hint tightly under its control", () => {
    expect(css).toMatch(/\.install-first-run__field \{[\s\S]*@apply mb-3/);
    expect(css).toMatch(/\.install-first-run__field \.field-label-row \{[\s\S]*@apply mb-0/);
    expect(css).toMatch(
      /\.install-first-run__field \.install-first-run__hint \{[\s\S]*@apply mb-0 mt-1\.5/,
    );
  });

  it("animates field feedback height open and closed without a reserved band", () => {
    expect(css).toMatch(
      /\.install-first-run__field-feedback \{[^}]*interpolate-size:\s*allow-keywords/,
    );
    expect(css).toMatch(/\.install-first-run__field-feedback \{[^}]*overflow:\s*hidden/);
    expect(css).toMatch(/\.install-first-run__field-feedback \{[^}]*height:\s*auto/);
    expect(css).toMatch(
      /\.install-first-run__field-feedback \{[^}]*transition:[^}]*height 200ms ease/,
    );
    expect(css).toMatch(/\.install-first-run__field-feedback--hidden \{[^}]*height:\s*0/);
    expect(css).toMatch(/\.install-first-run__field-feedback--hidden \{[^}]*opacity:\s*0/);
    expect(css).toMatch(
      /\.install-first-run__field-feedback--hidden \{[^}]*pointer-events:\s*none/,
    );
    expect(css).not.toMatch(/\.install-first-run__field-feedback \{[\s\S]*min-h-10/);
    expect(css).toMatch(
      /prefers-reduced-motion:\s*reduce[\s\S]*\.install-first-run__field-feedback \{[^}]*transition:\s*none/,
    );
  });

  it("aligns interrupt check icons to the first line of the label", () => {
    expect(css).toMatch(/\.install-first-run__check \{[\s\S]*@apply flex items-start/);
    expect(css).toMatch(/\.install-first-run__check-icon \{[\s\S]*@apply mt-0\.5 shrink-0/);
  });

  it("animates one engine panel height with interpolate-size, not a grid stack", () => {
    expect(css).toMatch(
      /\.install-first-run__engine-panels \{[^}]*interpolate-size:\s*allow-keywords/,
    );
    expect(css).toMatch(/\.install-first-run__engine-panel \{[^}]*overflow:\s*hidden/);
    expect(css).toMatch(/\.install-first-run__engine-panel \{[^}]*height:\s*auto/);
    expect(css).toMatch(
      /\.install-first-run__engine-panel \{[^}]*transition:[^}]*height 200ms ease/,
    );
    expect(css).toMatch(/\.install-first-run__engine-panel--hidden \{[^}]*height:\s*0/);
    expect(css).toMatch(/\.install-first-run__engine-panel--hidden \{[^}]*opacity:\s*0/);
    expect(css).toMatch(/\.install-first-run__engine-panel--hidden \{[^}]*pointer-events:\s*none/);
    expect(css).not.toMatch(/\.install-first-run__engine-panel \{[^}]*grid-area:\s*1 \/ 1/);
    expect(css).not.toMatch(/\.install-first-run__engine-panels \{[^}]*@apply grid/);
    expect(css).not.toMatch(/\.install-first-run__engine-panel \{[^}]*@apply visible/);
    expect(css).not.toMatch(/\.install-first-run__engine-panel--hidden \{[^}]*@apply invisible/);
    expect(css).not.toMatch(/\.install-first-run__engine-panel--hidden \{[^}]*display:\s*none/);
    expect(css).toMatch(
      /prefers-reduced-motion:\s*reduce[\s\S]*\.install-first-run__engine-panel \{[^}]*transition:\s*none/,
    );
  });
});
