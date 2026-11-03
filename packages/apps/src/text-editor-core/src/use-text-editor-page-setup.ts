import { useEffect } from "react";
import type { Editor } from "@tiptap/react";
import { isLiveEditor } from "@/text-editor-core/src/text-editor-live";
import { textEditorPageCssRule, type TextEditorPageSetup } from "@/lib/page-format";
import { applyTextEditorPageSetup } from "@/text-editor-core/src/text-editor-pagination";

const PAGE_STYLE_ATTRIBUTE = "data-text-editor-page";

/** Whether the editor shows separate pages: the person chose pages and the source split is closed. */
export function textEditorPaginated(
  pageSetup: TextEditorPageSetup | undefined,
  viewSource: boolean,
): boolean {
  return pageSetup?.layout === "pages" && !viewSource;
}

/** One `@page` rule while a Docs editor is mounted, so any print follows the paper size. */
function mountPageStyle(rule: string): () => void {
  const style = document.createElement("style");
  style.setAttribute(PAGE_STYLE_ATTRIBUTE, "");
  style.textContent = rule;
  document.head.appendChild(style);
  return () => style.remove();
}

/**
 * Keeps a live Docs editor in step with the person's page setup: paper size and pages
 * on/off without rebuilding the editor, and the print `@page` size.
 */
export function useTextEditorPageSetup(
  editor: Editor | null,
  pageSetup: TextEditorPageSetup | undefined,
  paginated: boolean,
): void {
  const format = pageSetup?.format;
  const orientation = pageSetup?.orientation;
  const layout = pageSetup?.layout;

  useEffect(() => {
    if (!format || !orientation || !layout || !isLiveEditor(editor)) return;
    applyTextEditorPageSetup(editor, { format, orientation, layout }, paginated);
  }, [editor, format, orientation, layout, paginated]);

  useEffect(() => {
    if (!format || !orientation) return;
    return mountPageStyle(textEditorPageCssRule({ format, orientation }));
  }, [format, orientation]);
}
