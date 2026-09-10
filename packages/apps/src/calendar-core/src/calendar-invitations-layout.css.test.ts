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

  it("keeps the inbox and segmented control from expanding the column", () => {
    const panel = readCss("calendar-invitations-panel.css");
    expect(panel).toMatch(/\.calendar-invitations-panel \{[\s\S]*min-w-0/);
    expect(panel).toMatch(/\.calendar-invitations-panel__filter \{[\s\S]*w-auto/);
    expect(panel).toMatch(/\.calendar-invitations-panel__filter \{[\s\S]*shrink-0/);
    expect(panel).not.toMatch(
      /\.calendar-invitations-panel__filter \.segmented-control__button \{[\s\S]*flex-1/,
    );
    expect(panel).toMatch(
      /\.calendar-invitations-panel \{[\s\S]*background-color:\s*var\(--app-sidebar-bg\)/,
    );
  });

  it("aligns invitations header padding with the main view-header chrome", () => {
    const panel = readCss("calendar-invitations-panel.css");
    expect(panel).toMatch(
      /\.calendar-invitations-panel \.docs-collab-sidebar-panel__header \{[\s\S]*p-4 md:p-6/,
    );
    expect(panel).toMatch(
      /@media\s*\(max-width:\s*40rem\)[\s\S]*\.calendar-invitations-panel \.docs-collab-sidebar-panel__header \{[\s\S]*p-3/,
    );
  });
});
