import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const tsx = readFileSync(join(here, "tasks-workspace.tsx"), "utf8");
const css = readFileSync(join(here, "tasks-workspace.css"), "utf8");
const colorCss = readFileSync(join(here, "../../workspace-shell/src/workspace-color.css"), "utf8");
const formTsx = readFileSync(join(here, "tasks-task-form.tsx"), "utf8");
const mainViewTsx = readFileSync(join(here, "tasks-main-view.tsx"), "utf8");
const listIconCss = readFileSync(join(here, "tasks-list-icon.css"), "utf8");

describe("tasks workspace header and sidebar", () => {
  it("shows the task count as parenthetical text beside the ViewHeader title", () => {
    expect(tsx).toMatch(/titleSuffix=\{/);
    expect(tsx).toMatch(/view-header__title-count/);
    expect(tsx).toMatch(/\(\{displayTasks\.length\}\)/);
    expect(tsx).not.toMatch(/from "@\/ui\/badge"/);
    expect(tsx).not.toMatch(/subtitle=\{L\.listTasks/);
  });

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

  it("keeps New task in the sidebar primary button, not the ViewHeader", () => {
    expect(tsx).toMatch(/primaryButton=\{\s*<TasksNewMenu/);
    expect(tsx).not.toMatch(/titlePrefix=/);
    expect(tsx).not.toMatch(/tasks-workspace__header-start/);
    const actionsBlock = tsx.match(
      /actions=\{\s*<div className="tasks-workspace__header-actions[\s\S]*?<\/div>\s*\}/,
    );
    expect(actionsBlock?.[0]).toBeDefined();
    expect(actionsBlock![0]).not.toMatch(/TasksNewMenu/);
  });

  it("uses an outline show-completed control with an accessible name", () => {
    const actionsBlock = tsx.match(
      /actions=\{\s*<div className="tasks-workspace__header-actions[\s\S]*?<\/div>\s*\}/,
    );
    expect(actionsBlock?.[0]).toBeDefined();
    expect(actionsBlock![0]).toMatch(/<Button\b/);
    expect(actionsBlock![0]).toMatch(/label=\{L\.showCompletedTasks\}/);
    expect(actionsBlock![0]).toMatch(
      /aria-label=\{\s*showCompletedTasks \? L\.hideCompletedTasks : L\.showCompletedTasks\s*\}/,
    );
    expect(actionsBlock![0]).toMatch(/tasks-workspace__show-completed/);
    expect(actionsBlock![0]).toMatch(/ICON_BUTTON_ACTIVE_CLASSNAME/);
    expect(actionsBlock![0]).not.toMatch(/label=\{showCompletedTasks \?/);
    expect(actionsBlock![0]).not.toMatch(/<IconButton\b[\s\S]*showCompletedTasks/);
  });

  it("wires edit-dialog delete through requestDeleteTask, gated by write rights", () => {
    expect(tsx).toMatch(/onDelete=\{/);
    expect(tsx).toMatch(/editingTaskWritable/);
    expect(tsx).toMatch(/requestDeleteTask\(editingTask\.id\)/);
  });

  it("uses Pink for the UI accent; primary fills use accent with Dark fg", () => {
    expect(css).toMatch(
      /\.tasks-workspace \{[\s\S]*?--workspace-accent:\s*var\(--color-we-got-pink\)/,
    );
    expect(colorCss).toMatch(
      /--workspace-accent-strong:\s*color-mix\(\s*in oklch,\s*var\(--workspace-accent\) 32%,\s*var\(--color-we-got-dark\)\s*\)/,
    );
    expect(css).toMatch(
      /\.tasks-workspace \{[\s\S]*?--button-primary-bg:\s*var\(--workspace-accent\)/,
    );
    expect(css).toMatch(
      /\.tasks-workspace \{[\s\S]*?--button-primary-fg:\s*var\(--color-we-got-dark\)/,
    );
    expect(css).not.toMatch(/--button-primary-bg:\s*var\(--workspace-accent-strong\)/);
    expect(css).not.toMatch(/--workspace-accent:\s*var\(--color-we-got-red\)/);
  });

  it("keeps switch-trigger lockup on pink tile + white marks", () => {
    expect(css).toMatch(
      /\.workspace-app-icon--switch-trigger \{[\s\S]*background-color:\s*var\(--color-we-got-pink\)/,
    );
    expect(css).toMatch(
      /\.workspace-app-icon--switch-trigger[\s\S]*svg \{[\s\S]*--wai-bg:\s*var\(--color-we-got-pink\)/,
    );
    expect(css).toMatch(
      /\.workspace-app-icon--switch-trigger[\s\S]*svg \{[\s\S]*--wai-fg:\s*#ffffff/,
    );
  });

  it("washes sidebar chrome for Pink and dials header outline chips with accent-strong", () => {
    expect(tsx).toMatch(/tasks-workspace__show-completed[\s\S]*variant="outline"/);
    expect(colorCss).toMatch(
      /--workspace-accent-strong:\s*color-mix\(\s*in oklch,\s*var\(--workspace-accent\) 32%,\s*var\(--color-we-got-dark\)\s*\)/,
    );
    expect(css).toMatch(
      /\.tasks-workspace \{[\s\S]*--button-active-color:\s*var\(--workspace-accent-strong\)/,
    );
    expect(css).toMatch(
      /\.tasks-workspace \{[\s\S]*--button-outline-hover-background:[\s\S]*var\(--workspace-accent\) 14%/,
    );
    expect(css).toMatch(
      /\.tasks-workspace \{[\s\S]*--button-outline-active-background:[\s\S]*var\(--workspace-accent\) 18%/,
    );
    expect(css).toMatch(
      /\.tasks-workspace \{[\s\S]*--button-outline-active-hover-background:[\s\S]*var\(--workspace-accent\) 24%/,
    );
    expect(css).toMatch(
      /--app-sidebar-item-hover-bg:\s*color-mix\(\s*in oklch,\s*var\(--workspace-accent\) 28%,\s*var\(--workspace-surface/,
    );
    expect(css).toMatch(
      /\.tasks-workspace \{[\s\S]*--app-sidebar-item-selected-bg:[\s\S]*var\(--workspace-accent\) 38%[\s\S]*var\(--workspace-surface/,
    );
    expect(css).toMatch(
      /\.tasks-workspace \{[\s\S]*--app-sidebar-item-selected-hover-bg:[\s\S]*var\(--workspace-accent\) 48%[\s\S]*var\(--workspace-surface/,
    );
    expect(css).toMatch(
      /\.tasks-workspace \{[\s\S]*--app-sidebar-item-selected-color:\s*var\(--color-we-got-dark\)/,
    );
    expect(css).toMatch(
      /\.tasks-workspace \.app-sidebar__scroll \{[\s\S]*--button-outline-hover-color:\s*var\(--color-we-got-dark\)/,
    );
    expect(css).toMatch(
      /\.tasks-workspace \.view-header \{[\s\S]*--button-active-color:\s*var\(--workspace-accent-strong\)/,
    );
    expect(css).toMatch(
      /\.tasks-workspace \.view-header \{[\s\S]*--button-outline-hover-color:\s*var\(--workspace-accent-strong\)/,
    );
    expect(css).toMatch(
      /\.tasks-dialog-surface \{[\s\S]*?--workspace-accent:\s*var\(--color-we-got-pink\)/,
    );
    expect(css).toMatch(
      /\.tasks-dialog-surface \{[\s\S]*?--button-primary-bg:\s*var\(--workspace-accent\)/,
    );
    expect(css).not.toMatch(
      /\.tasks-workspace \.tasks-workspace__header-actions \{[\s\S]*--button-outline-active-background/,
    );
    expect(css).not.toMatch(
      /\.tasks-workspace__show-completed\.button--variant-subtle\.icon-button--active/,
    );
  });

  it("keeps ViewHeader full-bleed without constraining to the content column", () => {
    expect(css).not.toMatch(
      /\.workspace-app-layout__main-header > div:first-child \{[\s\S]*grid-template-columns/,
    );
    expect(css).not.toMatch(
      /\.workspace-app-layout__main-header \.view-header__main \{[\s\S]*grid-column:\s*2/,
    );
  });

  it("shows a visible show-completed label from md and icon-only below", () => {
    expect(css).toMatch(
      /@media \(max-width:\s*767px\) \{[\s\S]*\.tasks-workspace__show-completed > \.button__label \{[\s\S]*sr-only/,
    );
  });
});
