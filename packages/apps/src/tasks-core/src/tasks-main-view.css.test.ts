import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "tasks-main-view.css"), "utf8");

describe("tasks main view complete control", () => {
  it("matches other disabled checkboxes for view-only complete", () => {
    const disabledBlock = css.match(/\.tasks-main-view__complete:disabled\s*\{[^}]+\}/);
    expect(disabledBlock?.[0]).toMatch(/cursor-not-allowed/);
    expect(disabledBlock?.[0]).toMatch(/opacity-50/);
    expect(css).toMatch(/\.tasks-main-view__complete:hover:not\(:disabled\)/);
  });
});
