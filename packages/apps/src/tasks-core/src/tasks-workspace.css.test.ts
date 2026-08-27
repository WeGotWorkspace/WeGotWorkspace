import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const tsx = readFileSync(join(here, "tasks-workspace.tsx"), "utf8");

describe("tasks workspace header and sidebar", () => {
  it("does not put an edit-list pencil in the ViewHeader action bar", () => {
    const actionsBlock = tsx.match(
      /actions=\{\s*<div className="tasks-workspace__header-actions[\s\S]*?<\/div>\s*\}/,
    );
    expect(actionsBlock?.[0]).toBeDefined();
    expect(actionsBlock![0]).not.toMatch(/openEditProjectDialog/);
    expect(actionsBlock![0]).not.toMatch(/Pencil/);
    expect(actionsBlock![0]).not.toMatch(/editList/);
  });

  it("keeps the sidebar row pencil for edit list", () => {
    expect(tsx).toMatch(/onEdit=\{openEditProjectDialog\}/);
    expect(tsx).toMatch(/editLabel=\{L\.editList\}/);
  });

  it("does not close the sidebar when Add list is clicked", () => {
    expect(tsx).toMatch(
      /onCreateList=\{canManageProjects \? openCreateProjectDialog : undefined\}/,
    );
    expect(tsx).not.toMatch(/onCreateList=\{[\s\S]*setSidebarOpen\(false\)/);
  });
});
