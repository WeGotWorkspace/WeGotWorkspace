import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const panel = readFileSync(join(here, "docs-collab-sidebar-panel.tsx"), "utf8");

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
});
