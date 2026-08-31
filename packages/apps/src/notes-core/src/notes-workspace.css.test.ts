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
const listPanel = readFileSync(join(here, "notes-list-panel.tsx"), "utf8");
const listPanelCss = readFileSync(join(here, "notes-list-panel.css"), "utf8");
const notebookSelect = readFileSync(join(here, "notes-notebook-select.tsx"), "utf8");
const notebookIconCss = readFileSync(join(here, "notes-notebook-color-icon.css"), "utf8");
const actionBarCss = readFileSync(join(here, "../../action-bar/src/action-bar.css"), "utf8");
const workspaceAppTsx = readFileSync(
  join(here, "../../workspace-app/src/workspace-app.tsx"),
  "utf8",
);
const selectionPresentation = readFileSync(
  join(here, "../../hooks/use-workspace-list-controller.tsx"),
  "utf8",
);

describe("notes workspace create title focus", () => {
  it("focuses the title after New note and keeps that request across id remap", () => {
    expect(tsx).toMatch(/beginCreateNote/);
    expect(tsx).toMatch(/setFocusTitleAfterCreate\(true\)/);
    expect(tsx).toMatch(/autoFocusTitle=\{focusTitleAfterCreate && !noteReadOnly\}/);
    expect(tsx).toMatch(/onAutoFocusTitleConsumed=\{\(\) => setFocusTitleAfterCreate\(false\)\}/);
    expect(tsx).toMatch(/handleSelectClearingTitleFocus/);
  });
});

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
    expect(tsx).not.toMatch(/NotesNotebookColorIcon/);
    expect(tsx).not.toMatch(/NotesNotebookRow/);
    expect(listPanel).toMatch(/<NotesNotebookColorIcon/);
    expect(listPanel).not.toMatch(/collection-sidebar-row__dot|notes-list-panel__notebook-dot/);
    expect(notebookSelect).toMatch(/<NotesNotebookColorIcon/);
    expect(notebookSelect).not.toMatch(/collection-sidebar-row__dot/);
    expect(listPanelCss).not.toMatch(/rounded-full/);
    expect(notebookIconCss).toMatch(/color:\s*var\(--collection-row-color/);
    expect(notebookIconCss).not.toMatch(/rounded-full/);
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
  it("maps detail editor checks to the same notebook wash as tags", () => {
    expect(css).toMatch(
      /--notes-detail-accent:\s*var\(--notes-detail-tint,\s*var\(--notes-accent\)\)/,
    );
    expect(css).toMatch(
      /\.notes-workspace \.note-text-editor-body \{[\s\S]*--checkbox-border-color:\s*color-mix\(\s*in oklab,\s*var\(--notes-detail-accent\) 28%/,
    );
    expect(css).toMatch(
      /\.notes-workspace \.note-text-editor-body \{[\s\S]*--checkbox-checked-bg:\s*color-mix\(\s*in oklab,\s*var\(--notes-detail-accent\) 16%/,
    );
    expect(css).toMatch(
      /\.notes-workspace \.note-text-editor-body \{[\s\S]*--checkbox-checked-border:\s*color-mix\(\s*in oklab,\s*var\(--notes-detail-accent\) 28%/,
    );
    expect(css).toMatch(
      /\.notes-workspace \.note-text-editor-body \{[\s\S]*--checkbox-checked-fg:\s*var\(--notes-detail-accent-strong\)/,
    );
    expect(css).not.toMatch(
      /\.notes-workspace \.note-text-editor-body \{[\s\S]*--checkbox-checked-bg:\s*var\(--notes-detail-accent\)/,
    );
    expect(css).not.toMatch(
      /\.notes-workspace \.note-text-editor-body \{[\s\S]*--checkbox-checked-fg:\s*var\(--notes-detail-check-fg/,
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
  it("paints list-row tags with the same idle family as sidebar chips", () => {
    expect(css).toMatch(/--notes-tag-bg:\s*color-mix\(in oklab,\s*var\(--color-ink\) 8%/);
    expect(css).toMatch(/--notes-tag-fg:\s*var\(--color-ink\)/);
    expect(css).toMatch(/--notes-tag-border:\s*color-mix\(in oklab,\s*var\(--color-ink\) 18%/);
    expect(css).toMatch(
      /\.notes-workspace \.notes-sidebar-tags__item \.tag,[\s\S]*\.list-item__tags \.tag \{[\s\S]*border-color:\s*var\(--notes-tag-border\)/,
    );
    expect(css).toMatch(
      /\.notes-workspace \.notes-sidebar-tags__item \.tag,[\s\S]*\.list-item__tags \.tag \{[\s\S]*background-color:\s*var\(--notes-tag-bg\)/,
    );
    expect(css).toMatch(
      /\.notes-workspace \.notes-sidebar-tags__item \.tag,[\s\S]*\.list-item__tags \.tag \{[\s\S]*color:\s*var\(--notes-tag-fg\)/,
    );
    expect(css).not.toMatch(/\.list-item__tags \.tag \{[\s\S]*--note-detail-tag-/);
    expect(css).not.toMatch(/--notes-tag-bg:\s*var\(--note-detail-tag-bg\)/);
    expect(css).not.toMatch(/--notes-tag-border:\s*var\(--note-detail-tag-border\)/);
  });

  it("keeps sidebar selected chips on ink + gold and detail chips on notebook accent", () => {
    expect(css).toMatch(/--notes-tag-selected-bg:\s*var\(--color-ink\)/);
    expect(css).toMatch(/--notes-tag-selected-fg:\s*var\(--notes-accent\)/);
    expect(css).toMatch(/--notes-tag-selected-border:\s*var\(--color-ink\)/);
    expect(css).toMatch(
      /--note-detail-tag-bg:\s*color-mix\(\s*in oklab,\s*var\(--notes-detail-accent\) 16%/,
    );
    expect(css).toMatch(/--note-detail-tag-fg:\s*var\(--notes-detail-accent-strong\)/);
    expect(css).toMatch(
      /--note-detail-tag-border:\s*color-mix\(\s*in oklab,\s*var\(--notes-detail-accent\) 28%/,
    );
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
    expect(css).not.toMatch(/--note-detail-tag-bg:\s*var\(--notes-detail-accent\)/);
    expect(css).not.toMatch(/--note-detail-tag-bg:\s*var\(--color-ink\)/);
  });
});

describe("notes workspace app-switch lockup", () => {
  it("paints the sidebar mark in yellow tints, not ink or gray", () => {
    expect(css).toMatch(
      /\.notes-workspace[\s\S]*\.app-switch-button__icon\.workspace-app-icon--switch-trigger \{[\s\S]*--app-switch-icon-bg:\s*var\(--notes-accent\)/,
    );
    expect(css).toMatch(
      /\.notes-workspace[\s\S]*\.app-switch-button__icon\.workspace-app-icon--switch-trigger \{[\s\S]*--app-switch-icon-fg:\s*color-mix\(\s*in oklab,\s*var\(--notes-accent\) 14%,\s*var\(--color-cream/,
    );
    expect(css).toMatch(
      /\.notes-workspace[\s\S]*\.workspace-app-icon--switch-trigger[\s\S]*svg \{[\s\S]*--wai-fg:\s*var\(--app-switch-icon-fg\)/,
    );
    expect(css).toMatch(
      /\.notes-workspace[\s\S]*\.workspace-app-icon--switch-trigger[\s\S]*svg \{[\s\S]*--wai-detail:\s*#f0bc3a/,
    );
    expect(css).toMatch(
      /\.notes-workspace[\s\S]*\.workspace-app-icon--switch-trigger[\s\S]*svg \{[\s\S]*--wai-cutout:\s*#f0bc3a/,
    );
    const lockup = css.slice(css.indexOf("App switcher lockup"));
    const lockupEnd = lockup.indexOf(".notes-dialog-surface");
    const lockupBlock = lockupEnd === -1 ? lockup : lockup.slice(0, lockupEnd);
    expect(lockupBlock).not.toMatch(/--color-ink/);
    expect(lockupBlock).not.toMatch(/--notes-accent-strong/);
    expect(lockupBlock).not.toMatch(/#000\b|#111|#333/);
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
      /\.notes-workspace[\s\S]*:is\(\.action-bar,\s*\.multi-selection-view__actions\)[\s\S]*\.icon-button--active \{[\s\S]*--button-active-color:\s*var\(--notes-detail-accent-strong\)/,
    );
    expect(css).toMatch(
      /\.notes-workspace[\s\S]*:is\(\.action-bar,\s*\.multi-selection-view__actions\)[\s\S]*\.icon-button--active \{[\s\S]*--button-subtle-background:[\s\S]*var\(--notes-detail-accent\) 18%/,
    );
    expect(css).toMatch(
      /\.notes-workspace[\s\S]*:is\(\.action-bar,\s*\.multi-selection-view__actions\)[\s\S]*\.icon-button--active \{[\s\S]*--button-subtle-hover-background:[\s\S]*var\(--notes-detail-accent\) 24%/,
    );
    expect(css).toMatch(
      /\.notes-workspace[\s\S]*:is\(\.action-bar,\s*\.multi-selection-view__actions\)[\s\S]*\.icon-button--active[\s\S]*fill:\s*none/,
    );
    expect(css).toMatch(
      /\.notes-workspace[\s\S]*:is\(\.action-bar,\s*\.multi-selection-view__actions\)[\s\S]*\.icon-button--active[\s\S]*color:\s*var\(--notes-detail-accent-strong\)/,
    );
    expect(css).not.toMatch(/var\(--calendar-accent/);
    expect(css).not.toMatch(
      /\.action-bar \.button--variant-subtle\.icon-button--active \{[\s\S]*--button-active-color:\s*var\(--color-ink\)/,
    );
    expect(selectionPresentation).toMatch(/icon:\s*<CheckCircle2 className="size-4" \/>/);
    expect(selectionPresentation).not.toMatch(/icon:\s*<X /);
  });

  it("paints the live detail-pane action bar cream, not a Storybook-only shell", () => {
    expect(css).toMatch(/--workspace-chrome-footer-bg:\s*var\(--color-cream/);
    expect(css).toMatch(
      /--action-bar-bg:\s*var\(--workspace-chrome-footer-bg,\s*var\(--color-cream/,
    );
    expect(css).toMatch(
      /\.notes-workspace \.workspace-detail-pane > \.action-bar \{\s*background-color:\s*var\(--workspace-chrome-footer-bg/,
    );
    expect(css).not.toMatch(
      /\.notes-workspace \.action-bar \{\s*background-color:\s*var\(--workspace-chrome-footer-bg/,
    );
    expect(actionBarCss).toMatch(
      /\.action-bar \{[\s\S]*background-color:\s*var\(\s*--action-bar-bg,/,
    );
    expect(workspaceAppTsx).toMatch(/className=\{cn\("workspace-detail-pane"/);
    expect(workspaceAppTsx).toMatch(/\{actionBar\?\.\(chrome\)\}/);
    expect(workspaceAppTsx).toMatch(/workspace-detail-pane__scroll/);
  });
});

describe("notes workspace detail paper sheet tokens", () => {
  it("paints the paper card with a very light notebook wash on a cream desk", () => {
    expect(css).toMatch(
      new RegExp(
        `--note-detail-sheet-bg:\\s*color-mix\\(\\s*in oklab,\\s*var\\(--notes-detail-tint,\\s*var\\(--color-cream,\\s*#ffffff\\)\\) ${NOTES_DETAIL_TINT_PERCENT}%,\\s*var\\(--color-cream`,
      ),
    );
    expect(css).toMatch(
      /--note-detail-sheet-shadow:\s*0 1px 1px color-mix\(in oklab,\s*var\(--color-ink\) 22%/,
    );
    expect(css).toMatch(
      /--note-detail-sheet-shadow:[\s\S]*0 3px 6px color-mix\(in oklab,\s*var\(--color-ink\) 12%/,
    );
    expect(css).toMatch(
      /--note-detail-sheet-shadow:[\s\S]*0 12px 20px -4px color-mix\(in oklab,\s*var\(--color-ink\) 14%/,
    );
    expect(css).toMatch(
      /--note-detail-sheet-shadow:[\s\S]*0 32px 48px -12px color-mix\(in oklab,\s*var\(--color-ink\) 16%/,
    );
    expect(css).not.toMatch(/0 12px 32px -12px/);
    expect(css).not.toMatch(/0 18px 28px -8px/);
    expect(css).toMatch(
      /@media \(max-width: 47\.999rem\) \{[\s\S]*\.note-detail-sheet \{[\s\S]*box-shadow:\s*none/,
    );
    expect(css).toMatch(/--notes-detail-body-bg:\s*var\(--workspace-detail-bg\)/);
    expect(css).not.toMatch(/--notes-detail-body-bg:\s*var\(--note-detail-sheet-bg\)/);
    expect(css).not.toMatch(
      /--note-detail-sheet-bg:\s*var\(--notes-detail-tint,\s*var\(--color-cream/,
    );
    expect(css).toMatch(/\.notes-workspace \.note-detail-sheet \{[\s\S]*min-height:\s*100%/);
    expect(css).toMatch(
      /\.notes-workspace \.workspace-detail-pane__scroll:has\(\.note-detail-sheet\) \{[\s\S]*flex-direction:\s*column/,
    );
    expect(css).toMatch(
      /@media \(max-width: 47\.999rem\) \{[\s\S]*\.workspace-detail-pane__scroll:has\(\.note-detail-sheet\) \{[\s\S]*px-0/,
    );
    expect(css).toMatch(
      /@media \(max-width: 47\.999rem\) \{[\s\S]*\.note-detail-sheet \{[\s\S]*max-w-none/,
    );
  });
});

describe("notes workspace detail notebook tint", () => {
  it("paints the detail desk cream like the footer, not a notes-accent wash", () => {
    expect(css).toMatch(
      /--workspace-detail-bg:\s*var\(--workspace-chrome-footer-bg,\s*var\(--color-cream/,
    );
    expect(css).toMatch(/--notes-detail-body-bg:\s*var\(--workspace-detail-bg\)/);
    expect(css).not.toMatch(
      /--workspace-detail-bg:\s*color-mix\(\s*in oklab,\s*var\(--notes-accent\) 12%/,
    );
    expect(css).not.toMatch(
      /--workspace-detail-bg:\s*color-mix\(\s*in oklab,\s*var\(--notes-detail-tint/,
    );
  });

  it("softens title/body ink onto the sheet, not full ink", () => {
    expect(css).toMatch(
      /--notes-detail-contrast-fg:\s*color-mix\(\s*in oklab,\s*var\(--color-ink\) 85%,\s*var\(--note-detail-sheet-bg/,
    );
    expect(css).not.toMatch(/--notes-detail-contrast-fg:\s*var\(--color-ink\)/);
  });

  it("sets --notes-detail-tint from the live notebook color for a single note only", () => {
    expect(tsx).toMatch(/notebookDisplayColor\(active, notebookCollections\)/);
    expect(tsx).toMatch(/notesDetailTintStyle\(notesDetailTint\)/);
    expect(tsx).toMatch(/const notesDetailTint =\s*showSingleNoteDetail && active/);
  });
});

describe("notes workspace selected list row", () => {
  it("paints selected/active list rows with the sidebar surface, not an accent wash", () => {
    expect(css).toMatch(/--list-item-selected-bg:\s*var\(--app-sidebar-bg\)/);
    expect(css).toMatch(/--list-item-active-bg:\s*var\(--app-sidebar-bg\)/);
    expect(css).toMatch(/--app-sidebar-bg:\s*var\(--notes-sidebar\)/);
    expect(css).not.toMatch(/--list-item-selected-bg:\s*color-mix/);
    expect(css).not.toMatch(/--list-item-selected-bg:\s*var\(--notes-accent/);
    expect(css).not.toMatch(/--list-item-selected-bg:\s*var\(--note-detail-sheet-bg/);
    expect(css).not.toMatch(/--list-item-selected-bg:\s*var\(--notes-detail-tint/);
    expect(css).not.toMatch(/--list-item-active-bg:\s*color-mix/);
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
