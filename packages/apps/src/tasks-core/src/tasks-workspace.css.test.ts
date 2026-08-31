import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const tsx = readFileSync(join(here, "tasks-workspace.tsx"), "utf8");
const css = readFileSync(join(here, "tasks-workspace.css"), "utf8");
const formTsx = readFileSync(join(here, "tasks-task-form.tsx"), "utf8");
const mainViewTsx = readFileSync(join(here, "tasks-main-view.tsx"), "utf8");
const listIconCss = readFileSync(join(here, "tasks-list-icon.css"), "utf8");

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

  it("wires owner delete through the list dialog, gated by mayDelete", () => {
    expect(tsx).toMatch(/projectDialog\.mayDelete/);
    expect(tsx).toMatch(/void deleteList\(projectDialog\.listId\)/);
  });

  it("wires CollectionSidebarRow visibility checkboxes", () => {
    expect(tsx).toMatch(/onToggleVisibility=\{\(\) => onToggleVisibility\(list\.id\)\}/);
    expect(tsx).toMatch(/visible=\{!hiddenTaskListIds\.has\(list\.id\)\}/);
    expect(tsx).toMatch(/<CollectionSidebarRow/);
    expect(tsx).not.toMatch(/TaskListIcon|TaskListDot|tasks-list-icon|tasks-list-dot/);
    expect(tsx).not.toMatch(/showColorDot/);
    expect(formTsx).toMatch(/<TaskListIcon/);
    expect(formTsx).not.toMatch(/TaskListDot|tasks-list-dot/);
    expect(mainViewTsx).toMatch(/<TaskListIcon/);
    expect(mainViewTsx).not.toMatch(/TaskListDot|tasks-list-dot/);
    expect(listIconCss).toMatch(/color:\s*var\(--collection-row-color/);
    expect(listIconCss).not.toMatch(/rounded-full/);
  });

  it("does not close the sidebar when Create list is clicked", () => {
    expect(tsx).toMatch(
      /onCreateList=\{canManageProjects \? openCreateProjectDialog : undefined\}/,
    );
    expect(tsx).not.toMatch(/onCreateList=\{[\s\S]*setSidebarOpen\(false\)/);
  });

  it("uses an icon-only show-completed control with an accessible name", () => {
    const actionsBlock = tsx.match(
      /actions=\{\s*<div className="tasks-workspace__header-actions[\s\S]*?<\/div>\s*\}/,
    );
    expect(actionsBlock?.[0]).toBeDefined();
    expect(actionsBlock![0]).toMatch(/<IconButton\b/);
    expect(actionsBlock![0]).toMatch(
      /label=\{showCompletedTasks \? L\.hideCompletedTasks : L\.showCompletedTasks\}/,
    );
    expect(actionsBlock![0]).toMatch(/tasks-workspace__show-completed/);
    expect(actionsBlock![0]).not.toMatch(/<Button\b[\s\S]*showCompletedTasks/);
  });

  it("wires edit-dialog delete through requestDeleteTask, gated by write rights", () => {
    expect(tsx).toMatch(/onDelete=\{/);
    expect(tsx).toMatch(/editingTaskWritable/);
    expect(tsx).toMatch(/requestDeleteTask\(editingTask\.id\)/);
  });

  it("washes the show-completed active state like Calendar Today / Notes Star", () => {
    expect(css).toMatch(
      /\.tasks-workspace__show-completed\.button--variant-subtle\.icon-button--active \{[\s\S]*--button-subtle-background:[\s\S]*var\(--tasks-accent\) 18%/,
    );
    expect(css).toMatch(
      /\.tasks-workspace__show-completed\.button--variant-subtle\.icon-button--active \{[\s\S]*--button-subtle-hover-background:[\s\S]*var\(--tasks-accent\) 24%/,
    );
    expect(css).toMatch(
      /\.tasks-workspace__show-completed\.button--variant-subtle\.icon-button--active \{[\s\S]*--button-active-color:\s*var\(--color-ink\)/,
    );
    expect(css).not.toMatch(
      /\.tasks-workspace__header-actions \.button--variant-subtle\.icon-button--active \{[\s\S]*background-color:\s*var\(--tasks-accent\)/,
    );
  });
});
