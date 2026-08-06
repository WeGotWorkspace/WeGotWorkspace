import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { Editor } from "@tiptap/react";
import { forwardOverlayWheelToEditorScroll } from "@/text-editor-core/src/text-editor-overlay-utils";
import {
  measureCommentCardViewportLeft,
  measureCommentFloatingLayerTopFromSurface,
} from "../docs-comments/docs-comments-positioning";
import { measureFloatingLayerContainerMaxHeight } from "../docs-comments/docs-comments-mark-visibility";

const CARD_MARGIN_GAP_PX = 16;
const CARD_BOTTOM_INSET_PX = 16;
const WORKSPACE_FOOTER_SELECTOR = ".workspace-chrome-footer, .docs-workspace__stats-footer";
const EDITOR_FORMAT_BAR_SELECTOR = ".text-editor-format-bar";

export type DocsCollabFloatingLayerLayout = {
  top: number;
  left: number;
  maxHeight: number;
};

export type UseDocsCollabFloatingLayerLayoutOptions = {
  editor: Editor | null;
  visible: boolean;
};

export type UseDocsCollabFloatingLayerLayoutResult = {
  layerRef: RefObject<HTMLDivElement | null>;
  containerLayout: DocsCollabFloatingLayerLayout | null;
};

export function useDocsCollabFloatingLayerLayout({
  editor,
  visible,
}: UseDocsCollabFloatingLayerLayoutOptions): UseDocsCollabFloatingLayerLayoutResult {
  const layerRef = useRef<HTMLDivElement>(null);
  const [containerLayout, setContainerLayout] = useState<DocsCollabFloatingLayerLayout | null>(
    null,
  );

  const syncContainerLayout = useCallback(() => {
    if (!editor) return;

    const surface = editor.view.dom.closest(".text-editor-sheet__surface") as HTMLElement | null;
    const footer = document.querySelector(WORKSPACE_FOOTER_SELECTOR) as HTMLElement | null;
    const left = measureCommentCardViewportLeft(surface, CARD_MARGIN_GAP_PX);
    const top = measureCommentFloatingLayerTopFromSurface(surface);
    const maxHeight = measureFloatingLayerContainerMaxHeight(top, footer, CARD_BOTTOM_INSET_PX);

    if (left == null) {
      setContainerLayout(null);
      return;
    }

    setContainerLayout({ top, left, maxHeight });
  }, [editor]);

  useEffect(() => {
    if (!editor || !visible) return;

    syncContainerLayout();

    const surface = editor.view.dom.closest(".text-editor-sheet__surface") as HTMLElement | null;
    const formatBar = editor.view.dom
      .closest(".text-editor")
      ?.querySelector(EDITOR_FORMAT_BAR_SELECTOR) as HTMLElement | null;
    const resizeObserver =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(syncContainerLayout) : null;
    if (surface) resizeObserver?.observe(surface);
    if (formatBar) resizeObserver?.observe(formatBar);
    window.addEventListener("resize", syncContainerLayout);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", syncContainerLayout);
    };
  }, [editor, visible, syncContainerLayout]);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer || !editor || !visible) return;

    const handleWheel = (event: WheelEvent) => {
      forwardOverlayWheelToEditorScroll(event, editor.view.dom, layer);
    };

    layer.addEventListener("wheel", handleWheel, { passive: false, capture: true });
    return () => layer.removeEventListener("wheel", handleWheel, { capture: true });
  }, [editor, visible]);

  return { layerRef, containerLayout };
}
