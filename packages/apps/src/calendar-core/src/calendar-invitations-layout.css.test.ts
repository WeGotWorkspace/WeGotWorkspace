import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

function readCss(relativePath: string): string {
  return readFileSync(join(here, relativePath), "utf8");
}

describe("calendar invitations dock width", () => {
  it("pins the right panel to a 23rem flex basis so RSVP actions stay on one line", () => {
    const workspace = readCss("calendar-workspace.css");
    expect(workspace).toMatch(/--calendar-invitations-column-width:\s*23rem/);
    expect(workspace).toMatch(
      /\.calendar-workspace \.workspace-app-layout__panel[\s\S]*flex:\s*0 0 var\(--calendar-invitations-column-width\)/,
    );
    expect(workspace).toMatch(
      /\.calendar-workspace \.workspace-app-layout__panel[\s\S]*max-width:\s*var\(--calendar-invitations-column-width\)/,
    );
    expect(workspace).toMatch(
      /\.calendar-workspace \.workspace-app-layout__main \{[\s\S]*?@apply[^\n]*min-w-0;/,
    );
    expect(workspace).toMatch(
      /\.calendar-workspace \.workspace-app-layout__panel[\s\S]*background-color:\s*var\(--app-sidebar-bg\)/,
    );
    expect(workspace).toMatch(
      /\.calendar-workspace__invitations-panel\[data-open="false"\][\s\S]*pointer-events-none/,
    );
  });

  it("keeps the inbox drawer width aligned with the dock", () => {
    const panel = readCss("calendar-invitations-panel.css");
    expect(panel).toMatch(/--side-drawer-width:\s*23rem/);
  });

  it("republishes Calendar accent on the portaled SideDrawer; sheet wash is shared", () => {
    const panel = readCss("calendar-invitations-panel.css");
    expect(panel).toMatch(
      /\.calendar-invitations-panel-drawer \{[\s\S]*--calendar-accent:\s*#6366f1/,
    );
    expect(panel).toMatch(
      /\.calendar-invitations-panel-drawer \{[\s\S]*--calendar-accent-strong:\s*#5558e8/,
    );
    expect(panel).toMatch(
      /\.calendar-invitations-panel-drawer \{[\s\S]*--workspace-accent:\s*var\(--calendar-accent\)/,
    );
    expect(panel).toMatch(
      /\.calendar-invitations-panel-drawer \{[\s\S]*--workspace-accent-strong:\s*var\(--calendar-accent-strong\)/,
    );
    expect(panel).not.toMatch(
      /\.calendar-invitations-panel-drawer \{[\s\S]*--docs-collab-sidebar-panel-wash:/,
    );
    expect(panel).not.toMatch(/\.calendar-invitations-panel-drawer \{[\s\S]*background-color:/);
    expect(panel).not.toMatch(
      /\.calendar-invitations-panel-drawer \{[\s\S]*--button-outline-hover-background:/,
    );
    const workspace = readFileSync(join(here, "calendar-workspace.tsx"), "utf8");
    expect(workspace).toMatch(/DOCS_COLLAB_SIDEBAR_PANEL_DRAWER_CLASS/);
    expect(workspace).toMatch(
      /className=\{`\$\{DOCS_COLLAB_SIDEBAR_PANEL_DRAWER_CLASS\} calendar-invitations-panel-drawer`\}/,
    );
  });

  it("keeps the inbox and segmented control from expanding the column", () => {
    const panel = readCss("calendar-invitations-panel.css");
    expect(panel).toMatch(/\.calendar-invitations-panel \{[\s\S]*min-w-0/);
    expect(panel).toMatch(/\.calendar-invitations-panel__filter \{[\s\S]*w-auto/);
    expect(panel).toMatch(/\.calendar-invitations-panel__filter \{[\s\S]*shrink-0/);
    expect(panel).not.toMatch(
      /\.calendar-invitations-panel__filter \.segmented-control__button \{[\s\S]*flex-1/,
    );
    expect(panel).toMatch(
      /\.calendar-invitations-panel \{[\s\S]*--docs-collab-sidebar-panel-bg:\s*var\(\s*--docs-collab-sidebar-panel-wash/,
    );
  });

  it("inherits shared panel padding-x; overrides only for Calendar main-header p-3 below 40rem", () => {
    const panel = readCss("calendar-invitations-panel.css");
    expect(panel).not.toMatch(
      /\.calendar-invitations-panel \{[\s\S]*--docs-collab-sidebar-panel-padding-x:\s*1rem/,
    );
    expect(panel).not.toMatch(
      /@media \(min-width:\s*768px\)[\s\S]*\.calendar-invitations-panel \{[\s\S]*--docs-collab-sidebar-panel-padding-x:\s*1\.5rem/,
    );
    expect(panel).toMatch(
      /@media\s*\(max-width:\s*40rem\)[\s\S]*\.calendar-invitations-panel \{[\s\S]*--docs-collab-sidebar-panel-padding-x:\s*0\.75rem/,
    );
    expect(panel).toMatch(
      /\.calendar-invitations-panel \.docs-collab-sidebar-panel__header \{[\s\S]*py-4 md:py-6/,
    );
    expect(panel).toMatch(
      /@media\s*\(max-width:\s*40rem\)[\s\S]*\.calendar-invitations-panel \.docs-collab-sidebar-panel__header \{[\s\S]*py-3/,
    );
    expect(panel).not.toMatch(
      /\.calendar-invitations-panel \.docs-collab-sidebar-panel__scroll \{[\s\S]*px-5/,
    );
  });
});
