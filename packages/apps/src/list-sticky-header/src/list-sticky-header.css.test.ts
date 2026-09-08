import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "list-sticky-header.css"), "utf8");

describe("list-sticky-header CSS", () => {
  it("sticks to the scroll top with a hairline and opaque list background", () => {
    expect(css).toMatch(/\.list-sticky-header \{[\s\S]*sticky top-0/);
    expect(css).toMatch(/\.list-sticky-header \{[\s\S]*border-b/);
    expect(css).toMatch(/--list-sticky-header-bg/);
    expect(css).toMatch(/var\(--color-cream, #ffffff\)/);
  });

  it("owns the split-label type language used by calendar list and chat days", () => {
    expect(css).toMatch(/\.list-sticky-header \{[\s\S]*flex items-baseline gap-2\.5/);
    expect(css).not.toMatch(/tracking-\[0\.04em\]/);
    expect(css).toMatch(/rgb\(15 23 42 \/ 96%\)/);
    expect(css).not.toMatch(/color-mix\(in oklab, var\(--color-ink\) 55%/);
    expect(css).toMatch(/--list-sticky-header-emphasis-font-size, 15px/);
    expect(css).toMatch(/--list-sticky-header-rest-font-size, 0\.875rem/);
    expect(css).toMatch(/\.list-sticky-header__emphasis \{[\s\S]*font-\[650\]/);
    expect(css).toMatch(/\.list-sticky-header__rest \{[\s\S]*font-\[450\]/);
    expect(css).toMatch(/\.list-sticky-header__rest \{[\s\S]*opacity-\[0\.82\]/);
  });
});
