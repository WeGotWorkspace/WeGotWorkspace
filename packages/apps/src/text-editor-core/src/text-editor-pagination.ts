import type { Editor } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { PaginationPlus } from "tiptap-pagination-plus";
import { createPageBreakFillPlugin } from "@/text-editor-core/src/text-editor-page-break-fill";
import { createPageRowsPlugin } from "@/text-editor-core/src/text-editor-page-rows";
import { textEditorPageBox, type TextEditorPageSetup } from "@/lib/page-format";

/** Space between two pages on screen, in CSS px. */
const PAGE_GAP_PX = 24;
/** The library's page gap draws a 1px border above and below it. */
const PAGE_GAP_BORDERS_PX = 2;
const PAGINATION_CLASS = "rm-with-pagination";
const PAGE_CONTENT_VAR_PREFIX = "--rm-page-content-";
const LIBRARY_STYLE_SELECTOR = "style[data-rm-pagination-style]";
const LIBRARY_INLINE_STYLES = ["border", "padding-left", "padding-right", "width"] as const;

type PaginationStorage = {
  enabled?: boolean;
  pageHeight?: number;
  pageGap?: number;
  marginTop?: number;
  marginBottom?: number;
};

function paginationStorage(editor: Editor): PaginationStorage | undefined {
  return (editor.storage as unknown as Record<string, PaginationStorage | undefined>)
    .PaginationPlus;
}

/** Library options for a page setup: fixed margins, no header, footer or page number. */
export function textEditorPaginationOptions(setup: TextEditorPageSetup, enabled: boolean) {
  const box = textEditorPageBox(setup);
  return {
    enabled,
    pageWidth: box.width,
    pageHeight: box.height,
    marginTop: box.margin,
    marginBottom: box.margin,
    marginLeft: box.margin,
    marginRight: box.margin,
    contentMarginTop: 0,
    contentMarginBottom: 0,
    pageGap: PAGE_GAP_PX,
    pageGapBorderSize: 1,
    // CSS variables resolve where the library writes them (inline styles), so the
    // page chrome follows light and dark theme from `text-editor.css`.
    pageGapBorderColor: "var(--text-editor-page-border)",
    pageBreakBackground: "var(--text-editor-page-gap)",
    headerLeft: "",
    headerRight: "",
    footerLeft: "",
    footerRight: "",
  };
}

/**
 * The library styles the editor root inline and keys its CSS (including table rules
 * meant for its own table extension) on `.rm-with-pagination`. Our stylesheet owns the
 * page box instead, and the class only stays on while pages are shown.
 */
function syncPaginationRoot(dom: HTMLElement, enabled: boolean) {
  for (const property of LIBRARY_INLINE_STYLES) dom.style.removeProperty(property);
  dom.classList.toggle(PAGINATION_CLASS, enabled);
}

/**
 * The library keeps measured page heights in `--rm-page-content-*` on the root and only
 * refreshes them once its page count settles. After a size change they would hold the
 * old size; without headers or footers the configured size is right, so drop them.
 */
function clearMeasuredPageHeights(dom: HTMLElement) {
  for (const name of Array.from(dom.style)) {
    if (name.startsWith(PAGE_CONTENT_VAR_PREFIX)) dom.style.removeProperty(name);
  }
}

/** Page geometry from the live settings, for page ends the library has not drawn yet. */
function pageEndFallback(storage: PaginationStorage) {
  const gap = (storage.pageGap ?? 0) + PAGE_GAP_BORDERS_PX;
  return {
    pagePeriod: (storage.pageHeight ?? 0) + gap,
    pageEndHeight: (storage.marginTop ?? 0) + (storage.marginBottom ?? 0) + gap,
  };
}

/** Height of one page's content area: no headers or footers, so page minus margins. */
function pageContentHeight(storage: PaginationStorage): number {
  return (storage.pageHeight ?? 0) - (storage.marginTop ?? 0) - (storage.marginBottom ?? 0);
}

/** The library adds one identical `<style>` per editor and never removes it. */
function dedupeLibraryStyles() {
  const styles = Array.from(document.head.querySelectorAll(LIBRARY_STYLE_SELECTOR));
  for (const style of styles.slice(1)) style.remove();
}

/**
 * The library's plugin state reads `editor.view`, which throws while the editor is not
 * mounted (before mount, or a late page-count frame after unmount). Keep the old state then.
 */
function guardUnmounted(plugin: Plugin, editor: Editor): Plugin {
  const state = plugin.spec.state;
  if (!state) return plugin;
  return new Plugin({
    ...plugin.spec,
    state: {
      ...state,
      apply(tr, value, oldState, newState) {
        if (editor.isDestroyed) return value;
        return state.apply.call(this, tr, value, oldState, newState);
      },
    },
  });
}

/**
 * `tiptap-pagination-plus` with our page chrome and forced page breaks. Decorations only:
 * the document, Markdown, Yjs and undo never see the pages.
 */
export const TextEditorPagination = PaginationPlus.extend({
  addStorage() {
    // The library seeds `enabled` from its defaults, not from the configured options.
    return { ...this.parent?.(), enabled: this.options.enabled };
  },

  onCreate(event) {
    this.parent?.(event);
    dedupeLibraryStyles();
    syncPaginationRoot(this.editor.view.dom, this.storage.enabled !== false);
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      ...(this.parent?.() ?? []).map((plugin) => guardUnmounted(plugin, editor)),
      createPageBreakFillPlugin({
        isEnabled: () => paginationStorage(editor)?.enabled !== false,
        fallback: () => pageEndFallback(paginationStorage(editor) ?? {}),
      }),
      createPageRowsPlugin({
        isEnabled: () => paginationStorage(editor)?.enabled !== false,
        contentHeight: () => pageContentHeight(paginationStorage(editor) ?? {}),
      }),
    ];
  },
});

export function createTextEditorPagination(setup: TextEditorPageSetup, enabled: boolean) {
  return TextEditorPagination.configure(textEditorPaginationOptions(setup, enabled));
}

/** Push a new page setup or pages on/off into a live editor without rebuilding it. */
export function applyTextEditorPageSetup(
  editor: Editor,
  setup: TextEditorPageSetup,
  enabled: boolean,
): void {
  // Before mount the extension options from creation already match.
  if (!editor.isInitialized || editor.isDestroyed || !paginationStorage(editor)) return;
  const options = textEditorPaginationOptions(setup, enabled);
  syncPaginationRoot(editor.view.dom, enabled);
  clearMeasuredPageHeights(editor.view.dom);
  const chain = editor.chain().updatePageSize({
    pageWidth: options.pageWidth,
    pageHeight: options.pageHeight,
    marginTop: options.marginTop,
    marginBottom: options.marginBottom,
    marginLeft: options.marginLeft,
    marginRight: options.marginRight,
  });
  (enabled ? chain.enablePagination() : chain.disablePagination()).run();
}
