import { useEffect, useState, useSyncExternalStore } from "react";
import type { Editor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { subscribeEditorLayoutUpdates } from "@/text-editor-core/src/text-editor-overlay-utils";

/** Where a floating format bar sits, relative to the sheet it floats in. */
export type TextEditorFloatingBarPosition = {
  left: number;
  top: number;
  /** `center` hangs the bar's middle on `left`; `end` its right edge (the image bar). */
  anchor: "center" | "end" | "start";
  placement: "above" | "below";
};

const REMEASURE_EVENT = "wgw-selection-bar-remeasure";
const BAR_SELECTOR = ".text-editor-format-bar--floating";
const OVERLAY_SELECTOR = '[role="menu"], [role="dialog"]';
/** Room above the selection the bar needs; with less it drops below. */
const ROOM_ABOVE = 110;
/** Half the bar's width until it has rendered and can be measured. */
const GUESS_HALF_WIDTH = 330;
const EDGE_GAP = 8;

const HOVER_QUERY = "(hover: hover)";

function subscribeHover(listener: () => void): () => void {
  const query = window.matchMedia?.(HOVER_QUERY);
  query?.addEventListener?.("change", listener);
  return () => query?.removeEventListener?.("change", listener);
}

/** A pointer that hovers (mouse, trackpad), as opposed to a touch screen. */
export function useCanHover(): boolean {
  return useSyncExternalStore(
    subscribeHover,
    () => window.matchMedia?.(HOVER_QUERY)?.matches ?? true,
    () => true,
  );
}

function barHasFocus(): boolean {
  const active = document.activeElement;
  if (active?.closest(BAR_SELECTOR)) return true;
  // An open menu or the link dialog holds focus while the selection is still being edited.
  return document.querySelector(OVERLAY_SELECTOR) !== null;
}

function halfBarWidth(sheet: Element): number {
  const bar = sheet.querySelector<HTMLElement>(BAR_SELECTOR);
  // `offsetWidth` is the layout width: not the transform's, and 0 until the bar renders.
  return bar?.offsetWidth ? bar.offsetWidth / 2 : GUESS_HALF_WIDTH;
}

function measure(editor: Editor, pointerDown: boolean): TextEditorFloatingBarPosition | null {
  const { selection } = editor.state;
  if (!editor.isEditable || pointerDown) return null;
  if (!(selection instanceof TextSelection) || selection.empty) return null;
  if (!editor.isFocused && !barHasFocus()) return null;
  const sheet = editor.view.dom.closest(".text-editor-sheet");
  if (!sheet) return null;
  const s = sheet.getBoundingClientRect();
  const start = editor.view.coordsAtPos(selection.from);
  const end = editor.view.coordsAtPos(selection.to);
  const sameLine = Math.abs(start.top - end.top) < 2;
  const below = start.top - s.top < ROOM_ABOVE && start.top < ROOM_ABOVE;
  const middle = (sameLine ? (start.left + end.left) / 2 : start.left) - s.left + sheet.scrollLeft;
  // Centred on the selection, but never hanging over the sheet's side edges.
  const half = Math.min(sheet.clientWidth / 2 - EDGE_GAP, halfBarWidth(sheet) + EDGE_GAP);
  return {
    left: Math.min(
      Math.max(middle, half + sheet.scrollLeft),
      sheet.scrollLeft + sheet.clientWidth - half,
    ),
    top: (below ? end.bottom : start.top) - s.top + sheet.scrollTop,
    anchor: "center",
    placement: below ? "below" : "above",
  };
}

/**
 * The spot for a format bar over the selected text, or null while there is nothing to
 * format: a caret, no focus, a read-only document, or a drag still in progress.
 */
export function useSelectionBarPosition(
  editor: Editor | null,
): TextEditorFloatingBarPosition | null {
  const [position, setPosition] = useState<TextEditorFloatingBarPosition | null>(null);

  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    let pointerDown = false;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (editor.isDestroyed) return;
        const next = measure(editor, pointerDown);
        setPosition((prev) =>
          prev === next ||
          (prev &&
            next &&
            prev.left === next.left &&
            prev.top === next.top &&
            prev.placement === next.placement)
            ? prev
            : next,
        );
      });
    };
    const onDown = (event: PointerEvent) => {
      if (event.target instanceof Node && dom.contains(event.target)) {
        pointerDown = true;
        update();
      }
    };
    const onUp = () => {
      if (!pointerDown) return;
      pointerDown = false;
      update();
    };
    dom.addEventListener(REMEASURE_EVENT, update);
    editor.on("transaction", update);
    editor.on("focus", update);
    editor.on("blur", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    const unsubscribeLayout = subscribeEditorLayoutUpdates(dom, update);
    update();
    return () => {
      cancelAnimationFrame(frame);
      dom.removeEventListener(REMEASURE_EVENT, update);
      editor.off("transaction", update);
      editor.off("focus", update);
      editor.off("blur", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      unsubscribeLayout();
    };
  }, [editor]);

  // The first frame guesses the bar's width; once it is on screen, settle on the real one.
  const shown = position !== null;
  useEffect(() => {
    if (shown && editor) editor.view.dom.dispatchEvent(new Event(REMEASURE_EVENT));
  }, [shown, editor]);

  return editor ? position : null;
}
