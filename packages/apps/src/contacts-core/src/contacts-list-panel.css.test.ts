import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const tsx = readFileSync(join(here, "contacts-list-panel.tsx"), "utf8");
const css = readFileSync(join(here, "contacts-workspace.css"), "utf8");

describe("contacts list section headers", () => {
  it("reuses ListStickyHeader instead of a contacts-only sticky row", () => {
    expect(tsx).toMatch(
      /import \{ ListStickyHeader \} from "@\/list-sticky-header\/src\/list-sticky-header"/,
    );
    expect(tsx).toMatch(/<ListStickyHeader id=\{`contacts-section-\$\{section\.letter\}`\}/);
    expect(css).not.toMatch(/contacts-list-panel__section-header/);
  });
});
