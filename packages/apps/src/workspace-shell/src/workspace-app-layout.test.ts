import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const tsx = readFileSync(join(here, "workspace-app-layout.tsx"), "utf8");
const css = readFileSync(join(here, "workspace-app-layout.css"), "utf8");

describe("WorkspaceUserFooter logout chrome", () => {
  it("uses sm outline IconButton matching header/sidebar chrome, not filled subtle", () => {
    const footerBlock = tsx.slice(
      tsx.indexOf("export function WorkspaceUserFooter"),
      tsx.indexOf("export function WorkspaceSidebarScrim"),
    );
    expect(tsx).toMatch(/import \{ IconButton \} from "@\/button\/src\/button"/);
    expect(footerBlock).toMatch(/label="Log out"/);
    expect(footerBlock).toMatch(/variant="outline"/);
    expect(footerBlock).toMatch(/size="sm"/);
    expect(footerBlock).not.toMatch(/variant="subtle"/);
    expect(tsx).not.toMatch(/size-9/);
    expect(tsx).not.toMatch(/linkHoverClassName/);
    expect(tsx).not.toMatch(/WORKSPACE_USER_LOGOUT_STYLE/);
  });

  it("does not force gray subtle fills on the footer logout", () => {
    expect(css).not.toMatch(/\.workspace-app-layout__user-footer \{[\s\S]*--button-subtle-/);
    expect(css).not.toMatch(
      /\.workspace-app-layout__user-footer \{[\s\S]*--workspace-user-footer-link-bg/,
    );
    expect(tsx).not.toMatch(/WORKSPACE_USER_LOGOUT_STYLE/);
  });
});

describe("WorkspaceSidebarToggle chrome", () => {
  it("uses outline IconButton matching Select/dropdown borders, not filled subtle", () => {
    const toggleBlock = tsx.match(/export function WorkspaceSidebarToggle\([\s\S]*?\n\}/)?.[0];
    expect(toggleBlock).toBeDefined();
    expect(toggleBlock!).toMatch(/variant="outline"/);
    expect(toggleBlock!).toMatch(/size="sm"/);
    expect(toggleBlock!).not.toMatch(/variant="subtle"/);
    expect(toggleBlock!).not.toMatch(/WORKSPACE_SIDEBAR_TOGGLE_STYLE/);
    expect(toggleBlock!).not.toMatch(/hoverClassName/);
    expect(tsx).not.toMatch(/workspace-app-layout\.styles/);
    expect(tsx).not.toMatch(/--workspace-sidebar-toggle-/);
  });

  it("marks open sidebar as pressed/active like Calendar invitations", () => {
    const toggleBlock = tsx.match(/export function WorkspaceSidebarToggle\([\s\S]*?\n\}/)?.[0];
    expect(toggleBlock).toBeDefined();
    expect(toggleBlock!).toMatch(/active=\{open\}/);
    expect(toggleBlock!).toMatch(/aria-pressed=\{open\}/);
    expect(toggleBlock!).toMatch(/className="workspace-sidebar-toggle shrink-0"/);
  });

  it("keeps active Lucide panel/menu marks as stroke (no solid fill blob)", () => {
    expect(css).toMatch(
      /\.workspace-sidebar-toggle\.button\.icon-button--active \.button__icon > svg \{[\s\S]*fill:\s*none/,
    );
  });
});
