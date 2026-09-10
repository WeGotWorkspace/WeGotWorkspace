import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "app-sidebar.css"), "utf8");

describe("app sidebar padding tokens", () => {
  it("derives item padding from the app-switch icon glyph inset", () => {
    expect(css).toMatch(/--app-sidebar-padding-x:\s*1rem/);
    expect(css).toMatch(/--app-switch-lockup-line:\s*calc\(1\.875rem \* 0\.85\)/);
    expect(css).toMatch(/--app-switch-icon-size:\s*calc\(2 \* var\(--app-switch-lockup-line\)\)/);
    expect(css).toMatch(
      /--app-switch-glyph-inset:\s*calc\(var\(--app-switch-icon-size\) \* 112 \/ 512\)/,
    );
    expect(css).toMatch(/--app-sidebar-item-padding-x:\s*var\(--app-switch-glyph-inset\)/);
  });
});
