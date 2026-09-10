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

  it("shows count as an accent Badge beside the title, not a ViewHeader subtitle", () => {
    expect(panel).toMatch(/from "@\/ui\/badge"/);
    expect(panel).toMatch(/titleSuffix=/);
    expect(panel).toMatch(/variant="accent"/);
    expect(panel).not.toMatch(/variant="secondary"/);
    expect(panel).not.toMatch(/subtitle=/);
  });
});
