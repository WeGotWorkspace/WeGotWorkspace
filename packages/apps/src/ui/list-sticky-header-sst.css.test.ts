import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "list-sticky-header-sst.css"), "utf8");

describe("list-sticky-header SST", () => {
  it("publishes cream sticky and calendar surface tokens on calendar workspace", () => {
    expect(css).toMatch(/\.calendar-workspace/);
    expect(css).toMatch(/--list-sticky-header-bg:\s*var\(--color-cream\)/);
    expect(css).toMatch(/--_lc-surface-bg:\s*var\(--color-cream\)/);
  });

  it("never falls back sticky or calendar surface bg to pure white", () => {
    expect(css).not.toMatch(/--list-sticky-header-bg:\s*#fff(?:fff)?\b/i);
    expect(css).not.toMatch(/--_lc-surface-bg:\s*#fff(?:fff)?\b/i);
    expect(css).not.toMatch(/--list-sticky-header-bg:\s*white\b/i);
    expect(css).not.toMatch(/--_lc-surface-bg:\s*white\b/i);
    expect(css).not.toMatch(/--list-sticky-header-bg:[^;]*#fff(?:fff)?\b/i);
    expect(css).not.toMatch(/--_lc-surface-bg:[^;]*light-dark\(\s*#fff\b/i);
  });
});

describe("docs editor desk cream (parity with sticky/calendar SST)", () => {
  const docsCss = readFileSync(join(here, "../docs-core/src/docs-workspace.css"), "utf8");

  it("asserts docs editor desk is sand cream, not pure #ffffff", () => {
    expect(docsCss).toMatch(/--docs-canvas:\s*var\(--color-cream\)/);
    expect(docsCss).toMatch(
      /\.text-editor-sheet--fill \{[\s\S]*background-color:\s*var\(--docs-canvas\)/,
    );
    expect(docsCss).not.toMatch(/--docs-canvas:\s*#fff(?:fff)?\b/i);
    expect(docsCss).not.toMatch(/--docs-surface:\s*#fff(?:fff)?\b/i);
  });
});
