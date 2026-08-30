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
    expect(tsx).toMatch(/onToggleVisibility=\{\(\) => onToggleVisibility\(notebook\.id\)\}/);
    expect(tsx).toMatch(/visible=\{!hiddenNotebookIds\.has\(notebook\.id\)\}/);
    expect(tsx).toMatch(/color=\{notebookDotColor\(notebook\)\}/);
    expect(tsx).not.toMatch(/showColorDot/);
    expect(tsx).not.toMatch(/NotesNotebookRow/);
    expect(tsx).toMatch(/CollectionSidebarMark/);
  });

  it("splits My notebooks and Shared with me like Tasks, hiding Shared when empty", () => {
    expect(tsx).toMatch(/title=\{L\.sectionNotebooks\}/);
    expect(tsx).toMatch(/title=\{L\.sidebarSharedWithMe\}/);
    expect(tsx).toMatch(/ownedNotebooks\.length > 0/);
    expect(tsx).toMatch(/sharedNotebookRows\.length > 0/);
    expect(tsx).not.toMatch(/title=\{L\.sectionSharedNotebooks\}/);
  });
});

describe("notes workspace editor checkboxes", () => {
  it("maps task-item marks to notes accent + ink check", () => {
    expect(css).toMatch(/--checkbox-checked-bg:\s*var\(--notes-accent\)/);
    expect(css).toMatch(/--checkbox-checked-fg:\s*var\(--color-ink\)/);
    expect(css).not.toMatch(/--checkbox-size:/);
  });
});

describe("notes workspace last-edited footer chip", () => {
  it("keeps the muted edited chip isolated from assigned tag ink/gold", () => {
    expect(css).toMatch(
      /\.notes-workspace \.notes-detail-footer__meta-tag--edited \{[\s\S]*--tag-bg:\s*color-mix\(in oklab,\s*var\(--color-ink\) 6%/,
    );
    expect(css).toMatch(
      /\.notes-workspace \.notes-detail-footer__meta-tag--edited \{[\s\S]*--tag-fg:\s*color-mix\(in oklab,\s*var\(--color-ink\) 58%/,
    );
    expect(css).toMatch(
      /\.notes-workspace \.notes-detail-footer__meta-tag--edited \.tag \{[\s\S]*background-color:\s*var\(--tag-bg\)/,
    );
  });
});

describe("notes workspace selected tag chips", () => {
  it("paints detail assigned tags with the selected sidebar chip tokens", () => {
    expect(css).toMatch(/--notes-tag-selected-bg:\s*var\(--color-ink\)/);
    expect(css).toMatch(/--notes-tag-selected-fg:\s*var\(--notes-accent\)/);
    expect(css).toMatch(/--notes-tag-selected-border:\s*var\(--color-ink\)/);
    expect(css).toMatch(/--note-detail-tag-bg:\s*var\(--notes-tag-selected-bg\)/);
    expect(css).toMatch(/--note-detail-tag-fg:\s*var\(--notes-tag-selected-fg\)/);
    expect(css).toMatch(/--note-detail-tag-border:\s*var\(--notes-tag-selected-border\)/);
    expect(css).toMatch(
      /\.notes-workspace \.notes-sidebar-tags__item--selected \.tag,[\s\S]*background-color:\s*var\(--notes-tag-selected-bg\)/,
    );
    expect(css).toMatch(
      /\.notes-workspace \.note-detail-view__tag-group \{[\s\S]*--tag-bg:\s*var\(--note-detail-tag-bg\)/,
    );
    expect(css).toMatch(
      /\.notes-workspace \.note-detail-view__tag-group \{[\s\S]*--tag-fg:\s*var\(--note-detail-tag-fg\)/,
    );
    expect(css).toMatch(
      /\.notes-workspace \.note-detail-view__tag-group \{[\s\S]*--tag-remove-fg:\s*var\(--note-detail-tag-fg\)/,
    );
    expect(css).toMatch(
      /\.notes-workspace \.note-detail-view__tag-group \.tag \{[\s\S]*border-color:\s*var\(--note-detail-tag-border\)/,
    );
    expect(css).not.toMatch(/--note-detail-tag-bg:\s*var\(--notes-accent\)/);
  });
});

describe("notes workspace action-bar selected Star/Archive", () => {
  it("colors selected action-bar icons with notes accent-strong, not grey/ink", () => {
    expect(css).toMatch(
      /--notes-accent-strong:\s*color-mix\(in oklab,\s*var\(--notes-accent\) 70%,\s*var\(--color-ink\)\)/,
    );
    expect(css).toMatch(
      /\.notes-workspace \.action-bar \.button--variant-subtle\.icon-button--active \{[\s\S]*--button-active-color:\s*var\(--notes-accent-strong\)/,
    );
    expect(css).toMatch(
      /\.notes-workspace \.action-bar \.button--variant-subtle\.icon-button--active \{[\s\S]*--button-subtle-background:[\s\S]*var\(--notes-accent\) 18%/,
    );
    expect(css).toMatch(
      /\.notes-workspace \.action-bar \.button--variant-subtle\.icon-button--active \{[\s\S]*--button-subtle-hover-background:[\s\S]*var\(--notes-accent\) 24%/,
    );
    expect(css).toMatch(
      /\.notes-workspace[\s\S]*\.action-bar[\s\S]*\.icon-button--active[\s\S]*fill:\s*none/,
    );
    expect(css).toMatch(
      /\.notes-workspace[\s\S]*\.action-bar[\s\S]*\.icon-button--active[\s\S]*color:\s*var\(--notes-accent-strong\)/,
    );
    expect(css).not.toMatch(/var\(--calendar-accent/);
    expect(css).not.toMatch(
      /\.action-bar \.button--variant-subtle\.icon-button--active \{[\s\S]*--button-active-color:\s*var\(--color-ink\)/,
    );
  });
});
