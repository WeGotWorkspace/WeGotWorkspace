import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "drive-detail-panel.css"), "utf8");
const workspaceCss = readFileSync(join(here, "drive-workspace.css"), "utf8");
const workspaceTsx = readFileSync(join(here, "drive-workspace.tsx"), "utf8");
const mainPane = readFileSync(join(here, "drive-main-pane.tsx"), "utf8");
const detailPanel = readFileSync(join(here, "drive-detail-panel.tsx"), "utf8");
const actionBar = readFileSync(join(here, "drive-detail-action-bar.tsx"), "utf8");

describe("Drive detail DocsCollabSidebarPanel shell", () => {
  it("uses DocsCollabSidebarPanel like Calendar invitations / Docs review", () => {
    expect(detailPanel).toMatch(/DocsCollabSidebarPanel/);
    expect(detailPanel).toMatch(/className="drive-detail-panel"/);
    expect(detailPanel).toMatch(/DriveDetailActionBar/);
    expect(detailPanel).toMatch(/showCloseButton=\{showCloseButton\}/);
    expect(detailPanel).toMatch(/empty=\{isEmpty\}/);
    expect(detailPanel).toMatch(/emptyLabel=\{labels\.detailEmpty\}/);
    expect(detailPanel).toMatch(/listClassName="drive-detail-panel__content"/);
  });

  it("places header actions as a single More menu; close is shared titleTrailing", () => {
    expect(actionBar).not.toMatch(/<\s*ActionBar[\s>]/);
    expect(actionBar).toMatch(/from "@\/button\/src\/button"/);
    expect(actionBar).toMatch(/DropdownMenu/);
    expect(actionBar).toMatch(/className="drive-detail-panel__actions"/);
    expect(actionBar).not.toMatch(/ACTION_BAR_MAX_INLINE_ACTIONS/);
    expect(css).toMatch(/\.drive-detail-panel__actions \{[\s\S]*flex[\s\S]*gap-1/);
  });

  it("uses a flat tile-like preview surface with centered kind-icon fallback", () => {
    expect(css).toMatch(/\.drive-detail-panel__preview \{[\s\S]*background-color:\s*#ffffff/);
    expect(css).toMatch(/\.drive-detail-panel__preview \{[\s\S]*color:\s*var\(--drive-accent/);
    expect(css).toMatch(
      /\.drive-detail-panel__preview \.file-preview__fallback[\s\S]*@apply flex items-center justify-center/,
    );
    expect(detailPanel).toMatch(/variant="detail"/);
  });

  it("docks full-height in WorkspaceAppLayout flex panel like Calendar/Docs", () => {
    expect(workspaceTsx).toMatch(/panel=\{/);
    expect(workspaceTsx).toMatch(/workspace-app-layout__panel drive-workspace__detail-panel/);
    expect(workspaceTsx).toMatch(/useDocsCommentsLayout/);
    expect(workspaceTsx).toMatch(/const detailPanelOpen = detailOpen/);
    expect(workspaceCss).toMatch(/--drive-detail-column-width:\s*22rem/);
    expect(workspaceCss).toMatch(/--workspace-panel-width:\s*var\(--drive-detail-column-width\)/);
    expect(workspaceCss).toMatch(
      /\.drive-workspace \.workspace-app-layout__panel[\s\S]*flex:\s*0 0 var\(--drive-detail-column-width\)/,
    );
    expect(workspaceCss).toMatch(
      /\.drive-workspace \.workspace-app-layout__panel[\s\S]*background-color:\s*var\(--docs-collab-sidebar-panel-wash\)/,
    );
    expect(mainPane).not.toMatch(/drive-detail-aside/);
    expect(mainPane).not.toMatch(/SideDrawer/);
    expect(mainPane).not.toMatch(/DriveDetailPanel/);
  });

  it("overlays with shared SideDrawer chrome on compact viewports like Calendar/Docs", () => {
    expect(workspaceTsx).toMatch(/SideDrawer/);
    expect(workspaceTsx).toMatch(/DOCS_COLLAB_SIDEBAR_PANEL_DRAWER_CLASS/);
    expect(workspaceTsx).toMatch(
      /className=\{`\$\{DOCS_COLLAB_SIDEBAR_PANEL_DRAWER_CLASS\} drive-detail-panel-drawer`\}/,
    );
    expect(workspaceTsx).not.toMatch(/showCloseButton=\{useDetailDrawer\}/);
    expect(css).toMatch(/--side-drawer-width:\s*22rem/);
  });

  it("opts into the shared DocsCollabSidebarPanel accent wash like Calendar invitations", () => {
    expect(workspaceCss).toMatch(
      /--docs-collab-sidebar-panel-wash:\s*color-mix\(\s*in oklab,\s*var\(--drive-accent\)\s*10%/,
    );
    expect(css).toMatch(
      /\.drive-detail-panel \{[\s\S]*--docs-collab-sidebar-panel-bg:\s*var\(\s*--docs-collab-sidebar-panel-wash/,
    );
  });

  it("republishes Drive accent on the portaled SideDrawer; sheet wash is shared", () => {
    expect(css).toMatch(/\.drive-detail-panel-drawer \{/);
    expect(css).toMatch(
      /\.drive-detail-panel-drawer \{[\s\S]*--workspace-accent:\s*var\(--drive-accent\)/,
    );
    expect(css).toMatch(/@import .*docs-collab-sidebar-panel\.css/);
  });
});
