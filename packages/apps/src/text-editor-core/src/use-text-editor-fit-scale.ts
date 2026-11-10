import { useEffect } from "react";
import type { Editor } from "@tiptap/react";
import {
  TEXT_EDITOR_FIT_SCALE_VAR,
  textEditorFitScale,
} from "@/text-editor-core/src/text-editor-fit-scale";

/** `tiptap-pagination-plus` draws the page gap 1px left of the page, with a border each side. */
const PAGE_GAP_OVERHANG_PX = 2;

function clearFit(dom: HTMLElement, surface: HTMLElement) {
  dom.style.removeProperty(TEXT_EDITOR_FIT_SCALE_VAR);
  dom.style.removeProperty("transform");
  dom.style.removeProperty("transform-origin");
  surface.style.removeProperty("width");
  surface.style.removeProperty("height");
}

function editorDom(editor: Editor): HTMLElement | null {
  try {
    return editor.view.dom;
  } catch {
    // The view is not mounted yet.
    return null;
  }
}

/** Keeps the page column fitted to its sheet while either changes size. */
export function useTextEditorFitScale(editor: Editor | null, enabled: boolean): void {
  useEffect(() => {
    if (!editor || !enabled || typeof ResizeObserver === "undefined") return;
    const dom = editorDom(editor);
    const surface = dom?.parentElement;
    const sheet = surface?.closest<HTMLElement>(".text-editor-sheet");
    if (!dom || !surface || !sheet) return;

    const apply = () => {
      const style = getComputedStyle(sheet);
      // The gap between pages pokes out a pixel past each page edge: leave it room, so a
      // fitted page never scrolls sideways.
      const available =
        sheet.clientWidth -
        (Number.parseFloat(style.paddingLeft) || 0) -
        (Number.parseFloat(style.paddingRight) || 0) -
        2 * PAGE_GAP_OVERHANG_PX;
      // A hidden pane has no width: keep what it had.
      if (!(available > 0)) return;
      const scale = textEditorFitScale(available, dom.offsetWidth);
      if (scale === 1) {
        clearFit(dom, surface);
        return;
      }
      dom.style.setProperty(TEXT_EDITOR_FIT_SCALE_VAR, String(scale));
      dom.style.transform = `scale(${scale})`;
      dom.style.transformOrigin = "0 0";
      // The transform leaves the layout box at full size: the surface takes the scaled one.
      surface.style.width = `${dom.offsetWidth * scale}px`;
      surface.style.height = `${dom.offsetHeight * scale}px`;
    };

    const observer = new ResizeObserver(apply);
    observer.observe(sheet);
    observer.observe(dom);
    apply();
    return () => {
      observer.disconnect();
      clearFit(dom, surface);
    };
  }, [editor, enabled]);
}
