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

describe("tasks composer select chips", () => {
  it("pins compact metrics with higher specificity than select-trigger defaults", () => {
    const block = css.match(/\.select-trigger\.tasks-main-view__composer-select \{[^}]+\}/)?.[0];
    expect(block).toMatch(/width:\s*auto/);
    expect(block).toMatch(/height:\s*2rem/);
    expect(block).toMatch(/font-size:\s*0\.75rem/);
    expect(block).toMatch(/padding-inline:\s*0\.5rem/);
    expect(css).toMatch(
      /\.select-trigger\.tasks-main-view__composer-select > span \{[\s\S]*-webkit-line-clamp:\s*unset/,
    );
    expect(css).toMatch(
      /\.tasks-main-view__composer-select \.tasks-main-view__composer-select-option \{/,
    );
  });
});
