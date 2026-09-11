import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "docs-collab-review-panel.css"), "utf8");
const workspace = readFileSync(join(here, "../docs-collab-workspace.tsx"), "utf8");

describe("docs collab review panel wash", () => {
  it("opts into the shared DocsCollabSidebarPanel accent wash like Calendar invitations", () => {
    expect(css).toMatch(
      /\.docs-collab-review-panel \{[\s\S]*--docs-collab-sidebar-panel-bg:\s*var\(\s*--docs-collab-sidebar-panel-wash/,
    );
    expect(css).toMatch(
      /\.docs-collab-review-panel \{[\s\S]*--docs-collab-sidebar-panel-wash-recipe:\s*color-mix\(\s*in oklab,\s*var\(--docs-accent/,
    );
  });

  it("republishes Docs accent on the portaled SideDrawer; sheet wash is shared", () => {
    expect(css).toMatch(/\.docs-collab-review-panel-drawer \{[\s\S]*--docs-accent:\s*#3b82f6/);
    expect(css).toMatch(
      /\.docs-collab-review-panel-drawer \{[\s\S]*--workspace-accent:\s*var\(--docs-accent\)/,
    );
    expect(css).not.toMatch(
      /\.docs-collab-review-panel-drawer \{[\s\S]*--docs-collab-sidebar-panel-wash:/,
    );
    expect(css).not.toMatch(/\.docs-collab-review-panel-drawer \{[\s\S]*background-color:/);
    expect(css).not.toMatch(
      /\.docs-collab-review-panel-drawer \{[\s\S]*--button-outline-hover-background:/,
    );
    expect(workspace).toMatch(/DOCS_COLLAB_SIDEBAR_PANEL_DRAWER_CLASS/);
    expect(workspace).toMatch(
      /className=\{`\$\{DOCS_COLLAB_SIDEBAR_PANEL_DRAWER_CLASS\} docs-collab-review-panel-drawer`\}/,
    );
  });

  it("keeps Open/Resolved filter chrome on the title row", () => {
    expect(css).toMatch(
      /\.docs-collab-review-panel \.docs-collab-sidebar-panel__header \{[\s\S]*py-4 md:py-6/,
    );
    expect(css).toMatch(/\.docs-collab-review-panel__filter \{[\s\S]*w-auto/);
  });

  it("inherits shared panel padding-x (main-header p-4 md:p-6) without product forks", () => {
    expect(css).not.toMatch(/--docs-collab-sidebar-panel-padding-x/);
    expect(css).not.toMatch(
      /\.docs-collab-review-panel \.docs-collab-sidebar-panel__scroll \{[\s\S]*px-5/,
    );
  });
});
