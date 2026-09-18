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
