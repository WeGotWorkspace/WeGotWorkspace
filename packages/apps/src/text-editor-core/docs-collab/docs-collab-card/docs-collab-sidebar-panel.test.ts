import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const panel = readFileSync(join(here, "docs-collab-sidebar-panel.tsx"), "utf8");
const css = readFileSync(join(here, "docs-collab-sidebar-panel.css"), "utf8");

describe("DocsCollabSidebarPanel", () => {
  it("uses outline close IconButton matching workspace chrome, not filled subtle", () => {
    expect(panel).toMatch(/variant="outline"/);
    expect(panel).not.toMatch(/variant="subtle"/);
    expect(panel).toMatch(/showCloseButton/);
  });

  it("shows count as parenthetical text beside the title, not a ViewHeader subtitle", () => {
    expect(panel).toMatch(/view-header__title-count/);
    expect(panel).toMatch(/titleSuffix=/);
    expect(panel).toMatch(/\(\{count\}\)/);
    expect(panel).not.toMatch(/from "@\/ui\/badge"/);
    expect(panel).not.toMatch(/subtitle=/);
  });

  it("renders a product-agnostic segmented filter in header actions", () => {
    expect(panel).toMatch(/filter\?: DocsCollabSidebarPanelFilter/);
    expect(panel).toMatch(/from "@\/segmented-control\/src\/segmented-control"/);
    expect(panel).toMatch(/docs-collab-sidebar-panel__filter/);
    expect(panel).toMatch(/SegmentedControl/);
  });

  it("defaults showCloseButton on so docked + drawer panels share titleTrailing close", () => {
    expect(panel).toMatch(/showCloseButton = true/);
    expect(panel).toMatch(/titleTrailing=\{closeButton\}/);
    expect(css).toMatch(/\.docs-collab-sidebar-panel__header \.view-header__end \{[\s\S]*gap-3/);
  });

  it("pins close to ViewHeader titleTrailing with gap-3 before it like Calendar/Docs", () => {
    expect(panel).toMatch(/titleTrailing=\{closeButton\}/);
    expect(panel).toMatch(/docs-collab-sidebar-panel__header-actions/);
    expect(css).toMatch(/\.docs-collab-sidebar-panel__header \.view-header__end \{[\s\S]*gap-3/);
    expect(css).toMatch(/\.docs-collab-sidebar-panel__header-actions \{[\s\S]*gap-1/);
  });

  it("publishes a shared accent-on-cream wash recipe for Calendar + Docs side panels", () => {
    expect(css).toMatch(
      /\.docs-collab-sidebar-panel \{[\s\S]*--docs-collab-sidebar-panel-wash-recipe:\s*color-mix\(\s*in oklab,\s*var\(--workspace-accent/,
    );
    expect(css).toMatch(
      /background-color:\s*var\(\s*--docs-collab-sidebar-panel-bg,\s*var\(--docs-surface/,
    );
  });

  it("paints portaled SideDrawer sheets from workspace-accent wash so overlay is not Sheet gray", () => {
    expect(panel).toMatch(
      /export const DOCS_COLLAB_SIDEBAR_PANEL_DRAWER_CLASS =\s*"docs-collab-sidebar-panel-drawer"/,
    );
    expect(css).toMatch(
      /\.docs-collab-sidebar-panel-drawer \{[\s\S]*--docs-collab-sidebar-panel-wash-recipe:\s*color-mix\(\s*in oklab,\s*var\(--workspace-accent/,
    );
    expect(css).toMatch(
      /\.docs-collab-sidebar-panel-drawer \{[\s\S]*--docs-collab-sidebar-panel-wash:\s*var\(--docs-collab-sidebar-panel-wash-recipe\)/,
    );
    expect(css).toMatch(
      /\.docs-collab-sidebar-panel-drawer \{[\s\S]*background-color:\s*var\(--docs-collab-sidebar-panel-wash\)/,
    );
  });

  it("republishes cream-surface outline button + segmented + menu washes on the drawer", () => {
    expect(css).toMatch(
      /\.docs-collab-sidebar-panel-drawer \{[\s\S]*--button-outline-hover-background:\s*color-mix\(\s*in oklab,\s*var\(--workspace-accent/,
    );
    expect(css).toMatch(
      /\.docs-collab-sidebar-panel-drawer \{[\s\S]*--button-outline-active-background:\s*color-mix\(\s*in oklab,\s*var\(--workspace-accent[\s\S]*18%/,
    );
    expect(css).toMatch(
      /\.docs-collab-sidebar-panel-drawer \{[\s\S]*--button-outline-active-hover-background:\s*color-mix\(\s*in oklab,\s*var\(--workspace-accent[\s\S]*24%/,
    );
    expect(css).toMatch(
      /\.docs-collab-sidebar-panel-drawer \{[\s\S]*--button-active-color:\s*var\(--docs-collab-sidebar-panel-accent-strong\)/,
    );
    expect(css).toMatch(
      /\.docs-collab-sidebar-panel-drawer \{[\s\S]*--button-outline-color:\s*var\(--color-ink\)/,
    );
    expect(css).toMatch(
      /\.docs-collab-sidebar-panel-drawer \{[\s\S]*--segmented-control-active-bg:\s*var\(--button-outline-active-background\)/,
    );
    expect(css).toMatch(
      /\.docs-collab-sidebar-panel-drawer \{[\s\S]*--segmented-control-active-fg:\s*var\(--button-active-color\)/,
    );
    expect(css).toMatch(
      /\.docs-collab-sidebar-panel-drawer \{[\s\S]*--menu-item-hover-background:\s*color-mix\(\s*in oklab,\s*var\(--workspace-accent/,
    );
  });

  it("aligns header title and empty/scroll body on main-header padding (p-4 md:p-6)", () => {
    expect(css).toMatch(
      /\.docs-collab-sidebar-panel \{[\s\S]*--docs-collab-sidebar-panel-padding-x:\s*1rem/,
    );
    expect(css).toMatch(
      /@media \(min-width:\s*768px\)[\s\S]*\.docs-collab-sidebar-panel \{[\s\S]*--docs-collab-sidebar-panel-padding-x:\s*1\.5rem/,
    );
    expect(css).toMatch(
      /\.docs-collab-sidebar-panel__header \{[\s\S]*padding-inline:\s*var\(--docs-collab-sidebar-panel-padding-x\)/,
    );
    expect(css).toMatch(
      /\.docs-collab-sidebar-panel__scroll \{[\s\S]*padding-inline:\s*var\(--docs-collab-sidebar-panel-padding-x\)/,
    );
    expect(css).not.toMatch(/\.docs-collab-sidebar-panel__empty \{[\s\S]*px-1/);
    expect(css).not.toMatch(/\.docs-collab-sidebar-panel__empty \{[\s\S]*padding-inline/);
  });
});
