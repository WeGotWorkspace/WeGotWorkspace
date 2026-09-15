import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { ViewMutationRecord } from "@tiptap/pm/view";
import type { DocsImageContentFetcher } from "@/text-editor-core/src/text-editor-image-content";
import { isHttpImageSrc, parseDriveFnSrc } from "@/text-editor-core/src/text-editor-image-src";

type ImageNodeView = {
  dom: HTMLImageElement;
  update: (node: ProseMirrorNode) => boolean;
  destroy: () => void;
  ignoreMutation: (mutation: ViewMutationRecord) => boolean;
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
 */
export function createDocsImageNodeView(
  node: ProseMirrorNode,
  fetchContent: DocsImageContentFetcher,
): ImageNodeView {
  const dom = document.createElement("img");
  let objectUrl: string | undefined;
  let cancelled = false;
  let token = 0;
  let currentNode = node;

  const revoke = () => {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = undefined;
    }
  };

  const resolveSrc = (next: ProseMirrorNode) => {
    applyStaticAttrs(dom, next);
    const src = typeof next.attrs.src === "string" ? next.attrs.src.trim() : "";
    const generation = ++token;
    cancelled = false;

    if (!src) {
      revoke();
      dom.removeAttribute("src");
      return;
    }
    if (isHttpImageSrc(src) || src.startsWith("data:")) {
      revoke();
      dom.src = src;
      return;
    }

    const nodeId = parseDriveFnSrc(src);
    if (!nodeId) {
      revoke();
      dom.removeAttribute("src");
      return;
    }

    revoke();
    dom.removeAttribute("src");
    void (async () => {
      try {
        const blob = await fetchContent(nodeId);
        if (cancelled || generation !== token) return;
        objectUrl = URL.createObjectURL(blob);
        dom.src = objectUrl;
      } catch {
        if (cancelled || generation !== token) return;
        dom.removeAttribute("src");
      }
    })();
  };

  resolveSrc(node);

  return {
    dom,
    update(updated) {
      if (updated.type !== currentNode.type) return false;
      const prevSrc = currentNode.attrs.src;
      currentNode = updated;
      if (updated.attrs.src !== prevSrc) {
        resolveSrc(updated);
      } else {
        applyStaticAttrs(dom, updated);
      }
      return true;
    },
    destroy() {
      cancelled = true;
      token += 1;
      revoke();
    },
    ignoreMutation(mutation) {
      return mutation.type === "attributes" && mutation.attributeName === "src";
    },
  };
}
