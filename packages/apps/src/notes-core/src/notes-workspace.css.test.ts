import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { NOTES_DETAIL_TINT_PERCENT } from "@/notes-core/src/notes-notebook-color";

const here = dirname(fileURLToPath(import.meta.url));
const tsx = readFileSync(join(here, "notes-workspace.tsx"), "utf8");
const css = readFileSync(join(here, "notes-workspace.css"), "utf8");
const actionBar = readFileSync(join(here, "notes-detail-action-bar.tsx"), "utf8");
const changeDialog = readFileSync(join(here, "notes-change-notebook-dialog.tsx"), "utf8");

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

describe("notes workspace change-notebook dialog", () => {
  it("reuses NotesNotebookSelect from the action bar", () => {
    expect(tsx).toMatch(/<NotesChangeNotebookDialog/);
    expect(tsx).toMatch(/notebookSelectValueForNotes\(notes, moveDialog\?\.ids, selectNotebooks\)/);
    expect(tsx).not.toMatch(/MoveToDialog/);
    expect(actionBar).toMatch(/<NotesNotebookSelect/);
    expect(changeDialog).toMatch(/<NotesNotebookSelect/);
    expect(changeDialog).not.toMatch(/RadioGroup|CREATE_NEW_VALUE|BookOpen/);
  });

  it("confirms the change-dialog draft with Change, not on select or create", () => {
    expect(changeDialog).toMatch(/label=\{confirmLabel\}/);
    expect(changeDialog).toMatch(/changeNotebookConfirm/);
    expect(changeDialog).toMatch(/onNotebookChange=\{setDraft\}/);
    expect(tsx).not.toMatch(/openCreateNotebook\(moveDialog\.ids\)/);
    expect(tsx).toMatch(/setCreatedMoveDraft/);
    expect(actionBar).toMatch(/onNotebookChange=\{onMoveToNotebook\}/);
  });
});

describe("notes workspace editor checkboxes", () => {
  it("maps detail editor fill to notebook accent and the check mark to contrast fg", () => {
    expect(css).toMatch(
      /--notes-detail-accent:\s*var\(--notes-detail-tint,\s*var\(--notes-accent\)\)/,
    );
    expect(css).toMatch(
      /\.notes-workspace \.note-text-editor-body \{[\s\S]*--checkbox-checked-bg:\s*var\(--notes-detail-accent\)/,
    );
    expect(css).toMatch(
      /\.notes-workspace \.note-text-editor-body \{[\s\S]*--checkbox-checked-border:\s*var\(--notes-detail-accent\)/,
    );
    expect(css).toMatch(
      /\.notes-workspace \.note-text-editor-body \{[\s\S]*--checkbox-checked-fg:\s*var\(--notes-detail-contrast-fg,\s*var\(--note-detail-tag-fg\)\)/,
    );
    expect(css).toMatch(
      /\.notes-workspace \{[\s\S]*--checkbox-checked-bg:\s*var\(--notes-accent\)/,
    );
    expect(css).toMatch(/\.notes-workspace \{[\s\S]*--checkbox-checked-fg:\s*var\(--color-ink\)/);
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
  it("keeps sidebar selected chips on ink + gold and detail chips on notebook fill", () => {
    expect(css).toMatch(/--notes-tag-selected-bg:\s*var\(--color-ink\)/);
    expect(css).toMatch(/--notes-tag-selected-fg:\s*var\(--notes-accent\)/);
    expect(css).toMatch(/--notes-tag-selected-border:\s*var\(--color-ink\)/);
    expect(css).toMatch(/--note-detail-tag-bg:\s*var\(--notes-detail-accent\)/);
    expect(css).toMatch(
      /--note-detail-tag-fg:\s*var\(--notes-detail-contrast-fg,\s*var\(--color-ink\)\)/,
    );
    expect(css).toMatch(/--note-detail-tag-border:\s*var\(--notes-detail-accent\)/);
    expect(css).not.toMatch(/--note-detail-tag-fg:\s*var\(--notes-tag-selected-fg\)/);
    expect(css).not.toMatch(/--note-detail-tag-fg:\s*var\(--notes-detail-accent\)/);
    expect(css).not.toMatch(/--note-detail-tag-fg:\s*var\(--notes-accent\)/);
    expect(css).toMatch(
      /\.notes-workspace \.notes-sidebar-tags__item--selected \.tag,[\s\S]*background-color:\s*var\(--notes-tag-selected-bg\)/,
    );
    expect(css).toMatch(
      /\.notes-workspace \.notes-sidebar-tags__item--selected \.tag,[\s\S]*color:\s*var\(--notes-tag-selected-fg\)/,
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
    expect(css).not.toMatch(/--note-detail-tag-bg:\s*var\(--color-ink\)/);
  });
});

describe("notes workspace action-bar selected Star/Archive", () => {
  it("colors selected action-bar icons with --notes-detail-accent, not leftover gold", () => {
    expect(css).toMatch(
      /--notes-accent-strong:\s*color-mix\(in oklab,\s*var\(--notes-accent\) 70%,\s*var\(--color-ink\)\)/,
    );
    expect(css).toMatch(
      /--notes-detail-accent-strong:\s*color-mix\(\s*in oklab,\s*var\(--notes-detail-accent\) 70%,\s*var\(--color-ink\)/,
    );
    expect(css).toMatch(
      /\.notes-workspace \.action-bar \.button--variant-subtle\.icon-button--active \{[\s\S]*--button-active-color:\s*var\(--notes-detail-accent-strong\)/,
    );
    expect(css).toMatch(
      /\.notes-workspace \.action-bar \.button--variant-subtle\.icon-button--active \{[\s\S]*--button-subtle-background:[\s\S]*var\(--notes-detail-accent\) 18%/,
    );
    expect(css).toMatch(
      /\.notes-workspace \.action-bar \.button--variant-subtle\.icon-button--active \{[\s\S]*--button-subtle-hover-background:[\s\S]*var\(--notes-detail-accent\) 24%/,
    );
    expect(css).toMatch(
      /\.notes-workspace[\s\S]*\.action-bar[\s\S]*\.icon-button--active[\s\S]*fill:\s*none/,
    );
    expect(css).toMatch(
      /\.notes-workspace[\s\S]*\.action-bar[\s\S]*\.icon-button--active[\s\S]*color:\s*var\(--notes-detail-accent-strong\)/,
    );
    expect(css).not.toMatch(/var\(--calendar-accent/);
    expect(css).not.toMatch(
      /\.action-bar \.button--variant-subtle\.icon-button--active \{[\s\S]*--button-active-color:\s*var\(--color-ink\)/,
    );
  });
});

describe("notes workspace detail notebook tint", () => {
  const eventColor = readFileSync(
    join(here, "../../lib/calendar-elements/utils/EventColor.ts"),
    "utf8",
  );

  it("mixes --workspace-detail-bg from --notes-detail-tint at Calendar light-wash %", () => {
    expect(eventColor).toMatch(/surfaceTint\(color,\s*11\)/);
    expect(NOTES_DETAIL_TINT_PERCENT).toBe(11);
    expect(css).toMatch(
      /--workspace-detail-bg:\s*color-mix\(\s*in oklab,\s*var\(--notes-detail-tint,\s*transparent\) 11%,\s*var\(--color-cream/,
    );
    expect(css).toMatch(/--notes-detail-body-bg:\s*var\(--workspace-detail-bg\)/);
    expect(css).not.toMatch(
      /--notes-detail-body-bg:\s*color-mix\(in oklab,\s*var\(--notes-accent\) 26%/,
    );
  });

  it("sets --notes-detail-tint from the live notebook color for a single note only", () => {
    expect(tsx).toMatch(/notebookDisplayColor\(active, notebookCollections\)/);
    expect(tsx).toMatch(/notesDetailTintStyle\(notesDetailTint\)/);
    expect(tsx).toMatch(/const notesDetailTint =\s*showSingleNoteDetail && active/);
  });
});

describe("notes workspace accent tokens", () => {
  it("uses brand warm yellow #f6d176 for chrome accents, mixed 12% onto cream", () => {
    const accent = css.match(
      /\.notes-workspace \{[\s\S]*?--notes-accent:\s*(#[0-9a-fA-F]{6})/,
    )?.[1];
    expect(accent?.toLowerCase()).toBe("#f6d176");
    expect(css).toMatch(/\.notes-dialog-surface \{[\s\S]*?--notes-accent:\s*#f6d176/i);
    expect(css).not.toMatch(/--notes-accent:\s*#d4bc72/i);
    expect(css).toMatch(
      /--notes-sidebar:\s*color-mix\(in oklab,\s*var\(--notes-accent\) 12%,\s*var\(--color-cream/,
    );
  });
});
