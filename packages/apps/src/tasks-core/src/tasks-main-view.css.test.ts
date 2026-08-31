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

describe("tasks complete control touch target", () => {
  it("keeps the checkbox above the row and does not capture the first tap with hover chrome", () => {
    expect(css).toMatch(/\.tasks-main-view__complete-wrap[\s\S]*z-\[1\]/);
    expect(css).toMatch(/\.tasks-main-view__complete-wrap[\s\S]*pointer-events:\s*auto/);
    expect(css).toMatch(/\.tasks-main-view__actions \{[\s\S]*pointer-events:\s*none/);
    expect(css).toMatch(
      /@media\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)[\s\S]*\.tasks-main-view__row:hover \.tasks-main-view__actions/,
    );
  });
});

describe("tasks remind button label", () => {
  it("keeps the labeled alert button from overflowing the composer", () => {
    expect(css).toMatch(/\.tasks-main-view__remind-button \{[\s\S]*max-w-full/);
    expect(css).toMatch(/\.tasks-main-view__remind--composer \{[\s\S]*max-w-full/);
  });
});

describe("tasks composer select chips", () => {
  it("pins compact metrics with higher specificity than select-trigger defaults", () => {
    const block = css.match(/\.select-trigger\.tasks-main-view__composer-select \{[^}]+\}/)?.[0];
    expect(block).toMatch(/width:\s*auto/);
    expect(block).toMatch(/height:\s*2rem/);
    expect(block).toMatch(/font-size:\s*0\.75rem/);
    expect(block).toMatch(/padding-inline:\s*0\.5rem/);
    expect(block).toMatch(/border-radius:\s*var\(--control-radius\)/);
    expect(css).toMatch(
      /\.select-trigger\.tasks-main-view__composer-select > span \{[\s\S]*-webkit-line-clamp:\s*unset/,
    );
    expect(css).toMatch(
      /\.tasks-main-view__composer-select \.tasks-main-view__composer-select-option \{/,
    );
  });

  it("pins the shared composer chip radius so due raw buttons match selects", () => {
    expect(css).toMatch(
      /\.tasks-main-view__composer-select \{[\s\S]*border-radius:\s*var\(--control-radius\)/,
    );
  });

  it("pins the remind trigger so production .button--size-sm cannot win", () => {
    const block = css.match(
      /\.tasks-main-view__composer-select\.tasks-main-view__remind-button \{[^}]+\}/,
    )?.[0];
    expect(block).toMatch(/height:\s*2rem/);
    expect(block).toMatch(/border-radius:\s*var\(--control-radius\)/);
    expect(block).toMatch(/padding-inline:\s*0\.5rem/);
    expect(block).toMatch(/font-size:\s*0\.75rem/);
  });

  it("lets Add task and Cancel use production Button size-sm metrics", () => {
    expect(css).not.toMatch(/\.tasks-main-view__composer-actions \.button\.button--size-sm \{/);
    const actions = css.match(/\.tasks-main-view__composer-actions \{[^}]+\}/)?.[0];
    expect(actions).toBeTruthy();
    expect(actions).not.toMatch(/--control-height-sm:\s*2rem/);
    expect(actions).not.toMatch(/--control-radius-button-pill:\s*var\(--control-radius\)/);
  });

  it("colors the assigned composer remind bell like the list-row mark", () => {
    expect(css).toMatch(
      /\.tasks-main-view__remind-button--active svg \{[\s\S]*var\(--button-active-color/,
    );
    expect(css).toMatch(
      /\.tasks-main-view__remind-button--active svg \{[\s\S]*fill:\s*currentColor/,
    );
  });

  it("overlays the remind badge without padding the chip or icon", () => {
    const remind = css.match(/\.tasks-main-view__remind \{[\s\S]*?\}/)?.[0];
    expect(remind).toBeTruthy();
    expect(remind).toMatch(/overflow-visible/);
    expect(remind).not.toMatch(/padding-block-start/);
    expect(remind).not.toMatch(/--tasks-remind-pad/);
    expect(css).not.toMatch(/--tasks-remind-pad/);
    expect(css).toMatch(/\.tasks-main-view__remind-badge \{[\s\S]*@apply[^\n]*absolute/);
    expect(css).toMatch(
      /\.tasks-main-view__remind-button \.tasks-main-view__composer-select-option > svg \{[\s\S]*m-0/,
    );
  });

  it("renders row reminders as plain meta text without a chip or truncate", () => {
    expect(css).not.toMatch(/\.tasks-main-view__remind-row-chip/);
    expect(css).not.toMatch(/\.tasks-main-view__remind--row[\s\S]*?\{[\s\S]*?truncate/);
    expect(css).not.toMatch(/\.tasks-main-view__remind--row[\s\S]*?\{[\s\S]*?\bborder\b/);
    expect(css).toMatch(/\.tasks-main-view__remind--row svg \{[\s\S]*var\(--tasks-accent/);
    expect(css).toMatch(/\.tasks-main-view__remind--row svg \{[\s\S]*fill:\s*currentColor/);
  });
});
