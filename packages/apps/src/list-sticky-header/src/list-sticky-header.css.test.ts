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
});
