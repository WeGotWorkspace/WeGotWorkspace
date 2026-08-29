import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const tsx = readFileSync(join(here, "notes-workspace.tsx"), "utf8");
const css = readFileSync(join(here, "notes-workspace.css"), "utf8");

describe("notes workspace sidebar create", () => {
  it("puts create notebook on the shared segmented New menu, not a section +", () => {
    expect(tsx).toMatch(/<NotesNewMenu/);
    expect(tsx).toMatch(
      /onCreateNotebook=\{canManageNotebooks \? \(\) => openCreateNotebook\(\) : undefined\}/,
    );
    expect(tsx).not.toMatch(/onAdd=\{canManageNotebooks/);
    expect(tsx).not.toMatch(/addLabel=\{L\.addNotebook\}/);
  });

  it("wires TaskProjectDialog Save to the shared notebook mutations", () => {
    expect(tsx).toMatch(/void createNotebookCollection\(input\)\.then/);
    expect(tsx).toMatch(/void updateNotebookCollection\(notebookDialog\.listId, input\)/);
    expect(tsx).toMatch(/pendingMoveAfterNotebookCreate/);
  });

  it("wires CollectionSidebarRow visibility checkboxes like Tasks/Calendar", () => {
    expect(tsx).toMatch(/onToggleVisibility=\{\(\) => toggleNotebookVisibility\(notebook\.id\)\}/);
    expect(tsx).toMatch(/visible=\{!hiddenNotebookIds\.has\(notebook\.id\)\}/);
    expect(tsx).toMatch(/color=\{notebookDotColor\(notebook\)\}/);
    expect(tsx).not.toMatch(/showColorDot/);
    expect(tsx).not.toMatch(/NotesNotebookRow/);
    expect(tsx).toMatch(/CollectionSidebarMark/);
  });
});

describe("notes workspace editor checkboxes", () => {
  it("maps task-item marks to notes accent + ink check", () => {
    expect(css).toMatch(/--checkbox-checked-bg:\s*var\(--notes-accent\)/);
    expect(css).toMatch(/--checkbox-checked-fg:\s*var\(--color-ink\)/);
  });
});
