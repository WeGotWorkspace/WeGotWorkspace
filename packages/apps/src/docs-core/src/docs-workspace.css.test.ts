import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "docs-workspace.css"), "utf8");
const colorCss = readFileSync(join(here, "../../workspace-shell/src/workspace-color.css"), "utf8");
const headerActions = readFileSync(join(here, "docs-header-actions.tsx"), "utf8");
const homePane = readFileSync(join(here, "docs-home-pane.tsx"), "utf8");
const collabWorkspace = readFileSync(
  join(here, "../../text-editor-core/docs-collab/docs-collab-workspace.tsx"),
  "utf8",
);

describe("docs workspace sheet elevation", () => {
  it("reuses the shared --sheet-shadow token for the editor paper sheet", () => {
    expect(css).toMatch(/--text-editor-shadow-sheet:\s*var\(--sheet-shadow\)/);
  });

  it("fills the canvas scrollport as a minimum and grows with content (Notes pattern)", () => {
    expect(css).not.toMatch(/--docs-sheet-min-height:\s*297mm/);
    expect(css).not.toMatch(/--docs-sheet-min-height:/);
    expect(css).toMatch(
      /--paper-sheet-min-height:\s*calc\(\s*100%\s*-\s*var\(--docs-sheet-canvas-padding-block-start\)/,
    );
    expect(css).toMatch(
      /\.docs-workspace__editor \.text-editor:not\(\.text-editor--view-source\) \.text-editor-sheet--fill \{[\s\S]*?overflow-y:\s*auto/,
    );
    /* Surface owns width only — height/min-height come from shared `.paper-sheet`. */
    expect(css).toMatch(
      /\.text-editor-sheet--fill\s+\.text-editor-sheet__surface \{[\s\S]*?\/\* height \/ min-height: shared `\.paper-sheet`/,
    );
  });

  it("uses equal sheet canvas block pads (no roomier bottom inset)", () => {
    expect(css).toMatch(
      /--docs-sheet-canvas-padding-block-start:\s*var\(--docs-sheet-canvas-padding-inline\)/,
    );
    expect(css).toMatch(
      /--docs-sheet-canvas-padding-block-end:\s*var\(--docs-sheet-canvas-padding-block-start\)/,
    );
    expect(css).not.toMatch(/--docs-sheet-canvas-padding-block-end:\s*2\.5rem/);
    expect(css).toMatch(
      /\.text-editor-sheet--fill \{[\s\S]*padding-block-start:\s*var\(--docs-sheet-canvas-padding-block-start\)/,
    );
    expect(css).toMatch(
      /\.text-editor-sheet--fill \{[\s\S]*padding-block-end:\s*var\(--docs-sheet-canvas-padding-block-end\)/,
    );
  });

  it("flushes the editor sheet below 767px — no canvas gutters, no paper shadow, full width", () => {
    expect(css).toMatch(
      /@media \(max-width: 767px\) \{[\s\S]*\.docs-workspace \{[\s\S]*--docs-sheet-canvas-padding-inline:\s*0/,
    );
    expect(css).toMatch(
      /@media \(max-width: 767px\) \{[\s\S]*\.docs-workspace \{[\s\S]*--docs-sheet-canvas-padding-block-start:\s*0/,
    );
    expect(css).toMatch(
      /@media \(max-width: 767px\) \{[\s\S]*\.docs-workspace \{[\s\S]*--docs-sheet-canvas-padding-block-end:\s*0/,
    );
    expect(css).toMatch(
      /@media \(max-width: 767px\) \{[\s\S]*\.docs-workspace \.text-editor \{[\s\S]*--text-editor-shadow-sheet:\s*none/,
    );
    expect(css).toMatch(
      /@media \(max-width: 767px\) \{[\s\S]*\.text-editor-sheet--fill \{[\s\S]*background-color:\s*var\(--paper-sheet-bg/,
    );
    expect(css).toMatch(
      /@media \(max-width: 767px\) \{[\s\S]*\.text-editor-sheet__surface \{[\s\S]*width:\s*100%;[\s\S]*max-width:\s*none/,
    );
  });

  it("keeps mobile sheet padding-top equal to shared sheet padding (not flush to format bar)", () => {
    expect(css).toMatch(
      /@media \(max-width: 767px\) \{[\s\S]*\.docs-workspace \.text-editor \{[\s\S]*--text-editor-sheet-padding-block-start:\s*1\.25rem/,
    );
    expect(css).toMatch(
      /@media \(max-width: 767px\) \{[\s\S]*\.text-editor-prose\s*>\s*:first-child \{[\s\S]*margin-block-start:\s*0/,
    );
  });
});

describe("docs workspace outline chrome", () => {
  it("uses Docs tile blue #0045ff as full-accent sidebar with cream main", () => {
    expect(css).toMatch(
      /\.docs-workspace \{[\s\S]*?--workspace-accent:\s*var\(--color-we-got-blue\)/,
    );
    expect(colorCss).toMatch(
      /--workspace-accent-strong:\s*color-mix\(\s*in oklch,\s*var\(--workspace-accent\) 32%,\s*var\(--color-ink\)\s*\)/,
    );
    expect(css).toMatch(/--app-sidebar-bg:\s*#0045ff/);
    expect(css).not.toMatch(
      /--app-sidebar-bg:\s*color-mix\(in oklch,\s*var\(--workspace-accent\)\s+\d+%,\s*var\(--color-cream/,
    );
    expect(css).toMatch(
      /\.docs-workspace \{[\s\S]*?--button-primary-bg:\s*var\(--workspace-accent\)/,
    );
    expect(css).not.toMatch(/--button-primary-bg:\s*var\(--workspace-accent-strong\)/);
    expect(css).not.toMatch(/--workspace-accent:\s*#3b82f6/);
    expect(css).not.toMatch(/--app-sidebar-bg:\s*#2563eb/);
    expect(css).toMatch(
      /\.docs-dialog-surface \{[\s\S]*?--workspace-accent:\s*var\(--color-we-got-blue\)/,
    );
    expect(colorCss).toMatch(/\.docs-dialog-surface/);
  });

  it("paints the editor desk sand cream — never pure white or cool gray wash", () => {
    expect(css).toMatch(/\.docs-workspace \{[\s\S]*--docs-surface:\s*var\(--color-cream\)/);
    expect(css).toMatch(/\.docs-workspace \{[\s\S]*--docs-canvas:\s*var\(--color-cream\)/);
    expect(css).toMatch(/\.docs-workspace \{[\s\S]*--workspace-main-bg:\s*var\(--docs-surface\)/);
    expect(css).toMatch(
      /\.docs-workspace__editor \.text-editor:not\(\.text-editor--view-source\) \.text-editor-sheet--fill \{[\s\S]*background-color:\s*var\(--docs-canvas\)/,
    );
    expect(css).not.toMatch(/--docs-canvas:\s*#fff(?:fff)?\b/i);
    expect(css).not.toMatch(/--docs-surface:\s*#fff(?:fff)?\b/i);
    expect(css).not.toMatch(/--workspace-main-bg:\s*#fff(?:fff)?\b/i);
    expect(css).not.toMatch(
      /--docs-canvas:\s*color-mix\(in oklch,\s*var\(--workspace-accent\)\s+\d+%/,
    );
  });

  it("swaps sidebar lockup to white tile + docs-accent marks (not transparent + white)", () => {
    expect(css).toMatch(
      /\.docs-workspace[\s\S]*\.app-switch-button__icon\.workspace-app-icon--switch-trigger \{[\s\S]*background-color:\s*#ffffff/,
    );
    expect(css).toMatch(
      /\.docs-workspace[\s\S]*\.workspace-app-icon--switch-trigger[\s\S]*svg \{[\s\S]*--wai-bg:\s*#ffffff/,
    );
    expect(css).toMatch(
      /\.docs-workspace[\s\S]*\.workspace-app-icon--switch-trigger[\s\S]*svg \{[\s\S]*--wai-fg:\s*var\(--workspace-accent\)/,
    );
    expect(css).not.toMatch(
      /\.docs-workspace[\s\S]*\.workspace-app-icon--switch-trigger[\s\S]*svg \{[\s\S]*--wai-bg:\s*transparent/,
    );
  });

  it("remaps nested Drive listing tokens to Docs blue on the workspace and dialog surface", () => {
    expect(css).toMatch(
      /:is\(\.docs-workspace,\s*\.docs-dialog-surface\) \.drive-workspace \{[\s\S]*--color-emerald:\s*var\(--workspace-accent\)/,
    );
    expect(css).toMatch(
      /\.docs-dialog-surface \{[\s\S]*--workspace-accent:\s*var\(--color-we-got-blue\)/,
    );
    expect(css).not.toMatch(/\.docs-dialog-surface \{[\s\S]*--workspace-accent:\s*#10b981/);
  });

  it("publishes outline tokens on the workspace and view-header (not ink-gray fallback)", () => {
    expect(css).toMatch(
      /\.docs-workspace \{[\s\S]*--button-outline-hover-color:\s*var\(--workspace-accent-strong\)/,
    );
    expect(css).toMatch(
      /\.docs-workspace \.view-header \{[\s\S]*--button-outline-color:\s*var\(--color-ink\)/,
    );
    expect(css).toMatch(
      /\.docs-workspace \.view-header \{[\s\S]*--button-outline-hover-color:\s*var\(--workspace-accent-strong\)/,
    );
    // Brace must keep surface tokens inside `.docs-workspace` (prior pass regression).
    expect(css).toMatch(
      /\.docs-workspace \{[\s\S]*--foreground:\s*var\(--docs-text\)[\s\S]*background-color:\s*var\(--docs-surface\)/,
    );
  });

  it("uses white-on-accent sidebar chrome with Mail-style darkened washes", () => {
    expect(css).toMatch(/--app-sidebar-bg:\s*#0045ff/);
    expect(css).toMatch(/--app-sidebar-color:\s*#ffffff/);
    expect(css).toMatch(/\.docs-workspace \.app-sidebar \{[\s\S]*--color-ink:\s*#ffffff/);
    expect(css).toMatch(
      /\.docs-workspace \.app-sidebar__scroll \{[\s\S]*--app-sidebar-item-hover-bg:\s*color-mix\(\s*in oklch,\s*#000000 10%,\s*var\(--app-sidebar-bg\)/,
    );
    expect(css).toMatch(
      /\.docs-workspace \.app-sidebar__scroll \{[\s\S]*--app-sidebar-item-selected-bg:\s*color-mix\(\s*in oklch,\s*#000000 14%,\s*var\(--app-sidebar-bg\)/,
    );
    expect(css).toMatch(
      /\.docs-workspace \.app-sidebar__scroll \{[\s\S]*--app-sidebar-item-selected-hover-bg:\s*color-mix\(\s*in oklch,\s*#000000 20%,\s*var\(--app-sidebar-bg\)/,
    );
    expect(css).toMatch(
      /\.docs-workspace \.app-sidebar__scroll \{[\s\S]*--app-sidebar-item-selected-color:\s*#ffffff/,
    );
    expect(css).toMatch(
      /\.docs-workspace \.app-sidebar__scroll \{[\s\S]*--button-outline-hover-color:\s*#ffffff/,
    );
    expect(css).toMatch(
      /\.docs-workspace \.app-sidebar \.sidebar-section \.menu-item--surface-idle \{[\s\S]*color:\s*#ffffff/,
    );
    expect(css).toMatch(
      /\.docs-workspace \.app-sidebar \.sidebar-section \.menu-item--surface-selected \{[\s\S]*color:\s*#ffffff/,
    );
    expect(css).toMatch(
      /\.docs-workspace \.app-sidebar \.sidebar-section \.menu-item \.menu-item__icon-slot \{[\s\S]*color:\s*#ffffff/,
    );
  });

  it("mirrors sidebar New primary onto the header notification unread badge", () => {
    expect(css).toMatch(
      /\.docs-workspace \.app-sidebar__scroll \{[\s\S]*--button-primary-bg:\s*#ffffff/,
    );
    expect(css).toMatch(
      /\.docs-workspace \.app-sidebar__scroll \{[\s\S]*--button-primary-fg:\s*var\(--app-sidebar-bg\)/,
    );
    expect(css).toMatch(
      /\.docs-workspace \.app-sidebar__notifications \{[\s\S]*--button-primary-bg:\s*#ffffff/,
    );
    expect(css).toMatch(
      /\.docs-workspace \.app-sidebar__notifications \{[\s\S]*--button-primary-fg:\s*var\(--app-sidebar-bg\)/,
    );
    expect(css).toMatch(
      /\.docs-workspace \.app-sidebar__notifications \{[\s\S]*--notification-inbox-badge-bg:\s*#ffffff/,
    );
    expect(css).toMatch(
      /\.docs-workspace \.app-sidebar__notifications \{[\s\S]*--notification-inbox-badge-fg:\s*var\(--app-sidebar-bg\)/,
    );
  });

  it("remaps footer logout outline washes to the same ink-into-blue tokens as sidebar scroll", () => {
    expect(css).toMatch(
      /\.docs-workspace \.app-sidebar__footer \{[\s\S]*--button-outline-hover-color:\s*#ffffff/,
    );
    expect(css).toMatch(
      /\.docs-workspace \.app-sidebar__footer \{[\s\S]*--button-outline-hover-background:\s*color-mix\(in oklch,\s*#000000 10%,\s*var\(--app-sidebar-bg\)\)/,
    );
    expect(css).toMatch(
      /\.docs-workspace \.app-sidebar__footer \{[\s\S]*--workspace-user-footer-text-color:\s*#ffffff/,
    );
  });

  it("uses outline IconButtons for header actions and home load-more", () => {
    expect(headerActions).toMatch(/variant="outline"/);
    expect(headerActions).not.toMatch(/variant="subtle"/);
    expect(homePane).toMatch(
      /labels\.homeLoadMore[\s\S]*?variant="outline"|variant="outline"[\s\S]*?labels\.homeLoadMore/,
    );
    expect(homePane).not.toMatch(/homeLoadMore[\s\S]{0,120}variant="subtle"/);
  });

  it("washes the review dock with a light accent tint, not the saturated nav rail", () => {
    expect(css).toMatch(
      /\.docs-workspace \{[\s\S]*--docs-collab-sidebar-panel-wash:\s*color-mix\(\s*in oklch,\s*var\(--workspace-accent\) 10%/,
    );
    expect(css).toMatch(
      /\.docs-workspace \.workspace-app-layout__panel \{[\s\S]*?background-color:\s*var\(--docs-collab-sidebar-panel-wash\);/,
    );
  });

  it("spaces review toggle from header actions like Calendar inbox from actions", () => {
    expect(css).toMatch(/\.docs-workspace \.view-header__end \{[\s\S]*gap-3/);
    expect(collabWorkspace).toMatch(
      /titleTrailing=\{\s*<IconButton[\s\S]*className="docs-workspace__review-toggle"/,
    );
    const actionsBlock = collabWorkspace.match(
      /actions=\{\s*<DocsHeaderActions[\s\S]*?actions=\{\[([\s\S]*?)\]\}/,
    );
    expect(actionsBlock?.[1]).toBeDefined();
    expect(actionsBlock![1]).not.toMatch(/docs-workspace__review-toggle/);
  });

  it("uses Tasks-style Suggest state-button responsive chrome (icon-only below md)", () => {
    expect(css).toMatch(
      /@media \(max-width:\s*767px\) \{[\s\S]*\.docs-collab-suggest-controls > \.button__label \{[\s\S]*sr-only/,
    );
    expect(css).toMatch(
      /@media \(max-width:\s*767px\) \{[\s\S]*\.docs-collab-suggest-controls\.button \{[\s\S]*px-0/,
    );
    expect(css).not.toMatch(/--segmented-control-active-bg/);
  });

  it("keeps the muted last-edited chip isolated from accent word/char stats", () => {
    expect(css).toMatch(
      /\.docs-workspace \.workspace-detail-footer__meta-tag--edited \{[\s\S]*--tag-bg:\s*color-mix\(in oklch,\s*var\(--color-ink\) 6%/,
    );
    expect(css).toMatch(
      /\.docs-workspace \.workspace-detail-footer__meta-tag--edited \{[\s\S]*--tag-fg:\s*color-mix\(in oklch,\s*var\(--color-ink\) 65%/,
    );
  });

  it("tints the busy last-edited spinner amber, not the header pending-sync slot", () => {
    expect(css).toMatch(
      /\.docs-workspace \.workspace-detail-footer__meta-tag--busy \{[\s\S]*--tag-fg:\s*#c98a1f/,
    );
    expect(css).toMatch(
      /\.docs-workspace \.workspace-detail-footer__meta-tag--busy \.loading-spinner \{[\s\S]*color:\s*#c98a1f/,
    );
    expect(css).not.toMatch(/\.docs-workspace__pending-sync/);
  });

  it("shares ViewHeader / format-bar / footer horizontal inset via --docs-format-chrome-padding-x", () => {
    expect(css).toMatch(/\.docs-workspace \{[\s\S]*--docs-format-chrome-padding-x:\s*1rem/);
    expect(css).toMatch(
      /@media \(min-width: 768px\) \{[\s\S]*\.docs-workspace \{[\s\S]*--docs-format-chrome-padding-x:\s*1\.5rem/,
    );
    expect(css).toMatch(
      /\.docs-workspace \.workspace-app-layout__main-header \{[\s\S]*padding-inline:\s*var\(--docs-format-chrome-padding-x\)/,
    );
    expect(css).toMatch(
      /\.docs-workspace__editor \.text-editor-format-bar \{[\s\S]*padding-inline:\s*var\(--docs-format-chrome-padding-x\)/,
    );
    expect(css).toMatch(
      /--workspace-chrome-footer-padding-x:\s*var\(--docs-format-chrome-padding-x\)/,
    );
  });

  it("aligns format-bar chrome with ViewHeader via shared padding; cluster centers inside", () => {
    // Contract: main-header and format-bar use the same inline padding token on
    // both sides. Cluster centering lives in text-editor.css (`safe center`) so
    // it does not add inset beyond that token (no nested __controls padding,
    // no 1fr side columns).
    expect(css).toMatch(
      /\.docs-workspace \.workspace-app-layout__main-header \{[\s\S]*padding-inline:\s*var\(--docs-format-chrome-padding-x\)/,
    );
    expect(css).toMatch(
      /\.docs-workspace__editor \.text-editor-format-bar \{[\s\S]*padding-inline:\s*var\(--docs-format-chrome-padding-x\)/,
    );
    expect(css).not.toMatch(
      /\.docs-workspace__editor \.text-editor-format-bar__controls \{[\s\S]*padding/,
    );
  });
});
