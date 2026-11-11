import type { Editor } from "@tiptap/core";
import { readTextEditorSheetPaddingToken } from "@/text-editor-core/src/text-editor-sheet-margin";
import { readTextEditorProseFontSizeToken } from "@/text-editor-core/src/text-editor-prose-font";

const PRINT_BODY_CLASS = "text-editor-print-active";
const PRINT_SURFACE_CLASS = "text-editor-sheet__surface--print";
/** Applied to `.text-editor` during print so view-source split prints formatted content only. */
export const TEXT_EDITOR_PRINT_FORMATTED_CLASS = "text-editor--print-formatted";
/** Mirrored on `html` during print so `@page` can read the sheet padding token. */
const PRINT_PAGE_MARGIN_VAR = "--text-editor-print-page-margin";
/** Mirrored on `html` during print so print typography matches the on-screen prose scale. */
const PRINT_PROSE_FONT_SIZE_VAR = "--text-editor-print-prose-font-size";

function findPrintSurface(editor: Editor): HTMLElement | null {
  const editorRoot = editor.view.dom.closest(".text-editor");
  if (!editorRoot) return null;

  // Always print the formatted WYSIWYG sheet — never the Markdown/HTML source pane.
  const formattedSurface = editorRoot.querySelector<HTMLElement>(
    ".text-editor__formatted .text-editor-sheet__surface",
  );
  if (formattedSurface) return formattedSurface;

  return editorRoot.querySelector<HTMLElement>(".text-editor-sheet__surface");
}

/** Mirror `--text-editor-sheet-padding` onto `html` for `@page` margin scope. */
function syncPrintPageMarginToken(editorRoot: Element | null): () => void {
  const root = document.documentElement;
  const previous = root.style.getPropertyValue(PRINT_PAGE_MARGIN_VAR);
  const token = readTextEditorSheetPaddingToken(editorRoot);
  root.style.setProperty(PRINT_PAGE_MARGIN_VAR, token);

  return () => {
    if (previous) {
      root.style.setProperty(PRINT_PAGE_MARGIN_VAR, previous);
    } else {
      root.style.removeProperty(PRINT_PAGE_MARGIN_VAR);
    }
  };
}

/** Mirror `--text-editor-prose-font-size` onto `html` for print typography scope. */
function syncPrintProseFontToken(editorRoot: Element | null): () => void {
  const root = document.documentElement;
  const previous = root.style.getPropertyValue(PRINT_PROSE_FONT_SIZE_VAR);
  const token = readTextEditorProseFontSizeToken(editorRoot);
  root.style.setProperty(PRINT_PROSE_FONT_SIZE_VAR, token);

  return () => {
    if (previous) {
      root.style.setProperty(PRINT_PROSE_FONT_SIZE_VAR, previous);
    } else {
      root.style.removeProperty(PRINT_PROSE_FONT_SIZE_VAR);
    }
  };
}

/** How long print waits for Drive images that are still loading. */
export const PRINT_IMAGE_WAIT_MS = 15_000;
const PRINT_IMAGE_POLL_MS = 100;

function imagePending(img: HTMLImageElement): boolean {
  if (img.dataset.loading === "true") return true;
  return img.hasAttribute("src") && !img.complete;
}

/** Resolve once no image in the sheet is loading, `cancelled()` is true, or after `timeoutMs`. */
export function waitForSheetImages(
  surface: HTMLElement,
  timeoutMs = PRINT_IMAGE_WAIT_MS,
  cancelled: () => boolean = () => false,
): Promise<void> {
  const pending = () => Array.from(surface.querySelectorAll("img")).some(imagePending);
  if (!pending()) return Promise.resolve();
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const check = () => {
      if (cancelled() || !pending() || Date.now() >= deadline) resolve();
      else window.setTimeout(check, PRINT_IMAGE_POLL_MS);
    };
    window.setTimeout(check, PRINT_IMAGE_POLL_MS);
  });
}

/**
 * Paper is white: print in the light theme, or dark mode's light text prints grey.
 * Returns the restore.
 */
function printInLightTheme(root: HTMLElement): () => void {
  const previous = root.dataset.theme;
  if (previous !== "dark") return () => {};
  root.dataset.theme = "light";
  return () => {
    root.dataset.theme = previous;
  };
}

function printAfterLayout(cancelled: () => boolean): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (!cancelled()) window.print();
    });
  });
}

/**
 * Print the editor sheet from the live document so fonts and styles match the UI.
 * Uses print-only CSS on `body` (see `text-editor.css`) — no iframe. Waits for Drive
 * images that are still loading, so no page prints without them.
 */
export function printTextEditorSheet(editor: Editor | null) {
  if (!editor) return;

  const surface = findPrintSurface(editor);
  if (!surface) {
    window.print();
    return;
  }

  const root = document.documentElement;
  const body = document.body;
  const editorRoot = surface.closest(".text-editor");

  root.classList.add(PRINT_BODY_CLASS);
  body.classList.add(PRINT_BODY_CLASS);
  surface.classList.add(PRINT_SURFACE_CLASS);
  editorRoot?.classList.add(TEXT_EDITOR_PRINT_FORMATTED_CLASS);

  const restores = [
    syncPrintPageMarginToken(editorRoot),
    syncPrintProseFontToken(editorRoot),
    printInLightTheme(root),
  ];

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    for (const restore of restores) restore();
    root.classList.remove(PRINT_BODY_CLASS);
    body.classList.remove(PRINT_BODY_CLASS);
    surface.classList.remove(PRINT_SURFACE_CLASS);
    editorRoot?.classList.remove(TEXT_EDITOR_PRINT_FORMATTED_CLASS);
    window.removeEventListener("afterprint", cleanup);
  };

  window.addEventListener("afterprint", cleanup);
  window.setTimeout(cleanup, 120_000 + PRINT_IMAGE_WAIT_MS);

  // The sheet can unmount, or `afterprint` can already have run, while images load.
  const cancelled = () => cleanedUp || !surface.isConnected;
  void waitForSheetImages(surface, PRINT_IMAGE_WAIT_MS, cancelled).then(() => {
    if (cancelled()) {
      cleanup();
      return;
    }
    printAfterLayout(cancelled);
  });
}
