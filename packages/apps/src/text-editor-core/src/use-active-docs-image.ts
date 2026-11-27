import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import {
  DOCS_IMAGE_LIVE_WIDTH_EVENT,
  type DocsImageLiveWidthDetail,
} from "@/text-editor-core/src/text-editor-image-attrs";
import { subscribeEditorLayoutUpdates } from "@/text-editor-core/src/text-editor-overlay-utils";

export type ActiveDocsImage = {
  pos: number;
  node: ProseMirrorNode;
  /** The picture's box, relative to the sheet the bar floats in. */
  rect: { top: number; left: number; width: number; height: number };
  /** Width in % while a handle is being dragged, ahead of the node attr. */
  liveWidth: number | null;
  /** Right-to-left text: the picture's end edge, where the bar sits, is its left one. */
  rtl: boolean;
  /** Viewport top of the picture: the bar drops below it when there is no room above. */
  viewportTop: number;
};

const CAPTION_CLASS = "text-editor-image__caption";

function imageAtWrapper(
  editor: Editor,
  wrapper: Element | null,
): { pos: number; node: ProseMirrorNode } | null {
  if (!wrapper) return null;
  let found: { pos: number; node: ProseMirrorNode } | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type.name === "image" && editor.view.nodeDOM(pos) === wrapper) found = { pos, node };
    return true;
  });
  return found;
}

/** The image in focus: node-selected, or its caption has the caret. */
function findFocusedImage(editor: Editor): { pos: number; node: ProseMirrorNode } | null {
  const { selection } = editor.state;
  if (selection instanceof NodeSelection && selection.node.type.name === "image") {
    return { pos: selection.from, node: selection.node };
  }
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !active.classList.contains(CAPTION_CLASS)) return null;
  if (!editor.view.dom.contains(active)) return null;
  return imageAtWrapper(editor, active.closest(".text-editor-image"));
}

/** A pointer that hovers (mouse, trackpad), as opposed to a touch screen. */
function canHover(): boolean {
  return window.matchMedia?.("(hover: hover)")?.matches ?? true;
}

const BAR_CLASS = ".text-editor-format-bar--floating";
/** Menus of the bar render in a portal; the pointer on them still counts as on the bar. */
const MENU_SELECTOR = '[role="menu"]';
const HOVER_LINGER_MS = 160;

/**
 * The image the bar floats over: the focused one, else (with a mouse) the one under the
 * pointer, with the bar and its menus counting as part of it. Plus where to put the bar.
 */
export function useActiveDocsImage(editor: Editor | null): ActiveDocsImage | null {
  const [active, setActive] = useState<ActiveDocsImage | null>(null);

  useEffect(() => {
    if (!editor) return;
    let hovered: Element | null = null;
    let liveWidth: number | null = null;
    let lingerTimer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      if (editor.isDestroyed || !editor.isEditable) return setActive(null);
      const hit = findFocusedImage(editor) ?? imageAtWrapper(editor, hovered);
      const wrapper = hit ? (editor.view.nodeDOM(hit.pos) as HTMLElement | null) : null;
      const frame = wrapper?.querySelector<HTMLElement>(".text-editor-image__frame");
      const sheet = editor.view.dom.closest<HTMLElement>(".text-editor-sheet");
      if (!hit || !frame || !sheet) return setActive(null);
      const f = frame.getBoundingClientRect();
      const s = sheet.getBoundingClientRect();
      // The sheet scrolls and the bar is absolute inside it: count how far it has scrolled.
      const rect = {
        top: f.top - s.top + sheet.scrollTop,
        left: f.left - s.left + sheet.scrollLeft,
        width: f.width,
        height: f.height,
      };
      setActive((prev) =>
        prev &&
        prev.pos === hit.pos &&
        prev.node === hit.node &&
        prev.viewportTop === f.top &&
        prev.liveWidth === liveWidth &&
        prev.rect.top === rect.top &&
        prev.rect.left === rect.left &&
        prev.rect.width === rect.width &&
        prev.rect.height === rect.height
          ? prev
          : {
              ...hit,
              rect,
              viewportTop: f.top,
              liveWidth,
              rtl: getComputedStyle(frame).direction === "rtl",
            },
      );
    };
    const onPointerOver = (event: MouseEvent) => {
      if (!canHover() || !(event.target instanceof Element)) return;
      const target = event.target;
      const over = target.closest(".text-editor-image");
      if (over && editor.view.dom.contains(over)) {
        clearTimeout(lingerTimer);
        if (hovered !== over) {
          hovered = over;
          update();
        }
        return;
      }
      if (target.closest(BAR_CLASS) || target.closest(MENU_SELECTOR)) {
        clearTimeout(lingerTimer);
        return;
      }
      if (!hovered) return;
      clearTimeout(lingerTimer);
      lingerTimer = setTimeout(() => {
        // The pointer crossed a gap on its way into a menu: the bar must not vanish under it
        // (that would close the menu). It lets go at the next move once the menu is closed.
        if (document.querySelector(MENU_SELECTOR)) return;
        hovered = null;
        update();
      }, HOVER_LINGER_MS);
    };
    const onLiveWidth = (event: Event) => {
      liveWidth = (event as CustomEvent<DocsImageLiveWidthDetail>).detail.width;
      update();
    };
    update();
    document.addEventListener(DOCS_IMAGE_LIVE_WIDTH_EVENT, onLiveWidth);
    document.addEventListener("mouseover", onPointerOver);
    editor.on("transaction", update);
    editor.on("update", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    const unsubscribeLayout = subscribeEditorLayoutUpdates(editor.view.dom, update);
    return () => {
      clearTimeout(lingerTimer);
      document.removeEventListener("mouseover", onPointerOver);
      document.removeEventListener(DOCS_IMAGE_LIVE_WIDTH_EVENT, onLiveWidth);
      editor.off("transaction", update);
      editor.off("update", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
      unsubscribeLayout();
    };
  }, [editor]);

  return active;
}
