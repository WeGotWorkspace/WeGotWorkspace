import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "switch.css"), "utf8");

describe("switch CSS tokens", () => {
  it("pins a compact track and uses primary/accent for the on fill", () => {
    expect(css).toMatch(/\.switch \{[\s\S]*--switch-track-width: 2\.75rem/);
    expect(css).toMatch(/\.switch \{[\s\S]*--switch-track-height: 1\.5rem/);
    expect(css).toMatch(/\.switch \{[\s\S]*--switch-thumb-size: 1\.25rem/);
    expect(css).toMatch(/\.switch \{[\s\S]*max-width: var\(--switch-track-width\)/);
    expect(css).toMatch(/\.switch \{[\s\S]*max-height: var\(--switch-track-height\)/);
    expect(css).toMatch(/\.switch \{[\s\S]*flex-basis: auto/);
    expect(css).not.toMatch(/flex:\s*0 0 var\(--switch-track-width\)/);
    expect(css).toMatch(
      /\.switch\[data-state="on"\] \{[\s\S]*--switch-on-bg, var\(--button-primary-bg, var\(--primary\)\)/,
    );
  });
});
