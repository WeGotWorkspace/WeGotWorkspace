import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { NodeViewRendererProps } from "@tiptap/core";
import type { Root } from "react-dom/client";
import type { ViewMutationRecord } from "@tiptap/pm/view";
import type { DocsImageContentFetcher } from "@/text-editor-core/src/text-editor-image-content";
import { deleteDocsImageAt } from "@/text-editor-core/src/text-editor-image-commands";
import {
  DOCS_IMAGE_DELETE_LABEL,
  mountTextEditorImageDeleteControl,
} from "@/text-editor-core/src/text-editor-image-delete-control";
import { isHttpImageSrc, parseDriveFnSrc } from "@/text-editor-core/src/text-editor-image-src";

export { DOCS_IMAGE_DELETE_LABEL };

type ImageNodeView = {
  dom: HTMLElement;
  update: (node: ProseMirrorNode) => boolean;
  destroy: () => void;
  ignoreMutation: (mutation: ViewMutationRecord) => boolean;
  selectNode: () => void;
  deselectNode: () => void;
  stopEvent: (event: Event) => boolean;
};

function applyStaticAttrs(dom: HTMLImageElement, node: ProseMirrorNode): void {
  const alt = typeof node.attrs.alt === "string" ? node.attrs.alt : "";
  const title = typeof node.attrs.title === "string" ? node.attrs.title : "";
  dom.alt = alt;
  if (title) dom.title = title;
  else dom.removeAttribute("title");
}

/**
 * DOM `src` is a `blob:` (or https) display URL. Document attrs stay `drive:fn-` / https.
 * Hover or NodeSelection shows a Docs-washed trash control; the node is removed from the doc, not Drive GC.
 */
export function createDocsImageNodeView(
  props: Pick<NodeViewRendererProps, "node" | "editor" | "getPos">,
  fetchContent: DocsImageContentFetcher,
): ImageNodeView {
  const { editor, getPos } = props;
  const wrapper = document.createElement("div");
  wrapper.className = "text-editor-image";
  wrapper.contentEditable = "false";

  const img = document.createElement("img");
  const deleteHost = document.createElement("div");
  deleteHost.className = "text-editor-image__delete-host";
  wrapper.append(img, deleteHost);

  let objectUrl: string | undefined;
  let cancelled = false;
  let token = 0;
  let currentNode = props.node;
  let deleteRoot: Root | null = null;

  const revoke = () => {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = undefined;
    }
  };

  const syncDeleteAvailability = () => {
    deleteHost.hidden = !editor.isEditable;
  };

  const resolveSrc = (next: ProseMirrorNode) => {
    applyStaticAttrs(img, next);
    const src = typeof next.attrs.src === "string" ? next.attrs.src.trim() : "";
    const generation = ++token;
    cancelled = false;

    if (!src) {
      revoke();
      img.removeAttribute("src");
      return;
    }
    if (isHttpImageSrc(src) || src.startsWith("data:")) {
      revoke();
      img.src = src;
      return;
    }

    const nodeId = parseDriveFnSrc(src);
    if (!nodeId) {
      revoke();
      img.removeAttribute("src");
      return;
    }

    revoke();
    img.removeAttribute("src");
    void (async () => {
      try {
        const blob = await fetchContent(nodeId);
        if (cancelled || generation !== token) return;
        objectUrl = URL.createObjectURL(blob);
        img.src = objectUrl;
      } catch {
        if (cancelled || generation !== token) return;
        img.removeAttribute("src");
      }
    })();
  };

  deleteRoot = mountTextEditorImageDeleteControl(deleteHost, {
    onDelete: () => {
      if (!editor.isEditable) return;
      const pos = getPos();
      if (typeof pos !== "number") return;
      deleteDocsImageAt(editor, pos);
    },
  });
  syncDeleteAvailability();

  resolveSrc(props.node);

  return {
    dom: wrapper,
    update(updated) {
      if (updated.type !== currentNode.type) return false;
      const prevSrc = currentNode.attrs.src;
      currentNode = updated;
      if (updated.attrs.src !== prevSrc) {
        resolveSrc(updated);
      } else {
        applyStaticAttrs(img, updated);
      }
      return true;
    },
    selectNode() {
      wrapper.classList.add("ProseMirror-selectednode");
      syncDeleteAvailability();
    },
    deselectNode() {
      wrapper.classList.remove("ProseMirror-selectednode");
      syncDeleteAvailability();
    },
    stopEvent(event) {
      const target = event.target;
      return target instanceof Node && deleteHost.contains(target);
    },
    destroy() {
      cancelled = true;
      token += 1;
      deleteRoot?.unmount();
      deleteRoot = null;
      revoke();
    },
    ignoreMutation(mutation) {
      if (mutation.target instanceof Node && deleteHost.contains(mutation.target)) {
        return true;
      }
      return (
        mutation.type === "attributes" &&
        mutation.target === img &&
        mutation.attributeName === "src"
      );
    },
  };
}
