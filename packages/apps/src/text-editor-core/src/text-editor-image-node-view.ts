import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { Editor, NodeViewRendererProps } from "@tiptap/core";
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

const INSECURE_IMAGE_BLOCKED_TEXT = "Insecure image blocked";

/** Reader opt-in for one https src. Keyed by the editor so it dies with that document. */
const externalImageOptInByEditor = new WeakMap<Editor, Set<string>>();

type ImageNodeView = {
  dom: HTMLElement;
  update: (node: ProseMirrorNode) => boolean;
  destroy: () => void;
  ignoreMutation: (mutation: ViewMutationRecord) => boolean;
  selectNode: () => void;
  deselectNode: () => void;
  stopEvent: (event: Event) => boolean;
};

type ExternalImageChrome = {
  img: HTMLImageElement;
  loadButton: HTMLButtonElement;
  blockedNotice: HTMLElement;
};

function rememberExternalImageOptIn(editor: Editor, src: string): void {
  let allowed = externalImageOptInByEditor.get(editor);
  if (!allowed) {
    allowed = new Set();
    externalImageOptInByEditor.set(editor, allowed);
  }
  allowed.add(src);
}

function hasExternalImageOptIn(editor: Editor, src: string): boolean {
  return externalImageOptInByEditor.get(editor)?.has(src) ?? false;
}

function parsedHttpUrl(src: string): URL | null {
  if (!isHttpImageSrc(src)) return null;
  try {
    return new URL(src);
  } catch {
    return null;
  }
}

function httpsImageHost(src: string): string | null {
  const url = parsedHttpUrl(src);
  if (!url || url.protocol !== "https:" || url.host.length === 0) return null;
  return url.host;
}

function isInsecureHttpImageSrc(src: string): boolean {
  return parsedHttpUrl(src)?.protocol === "http:";
}

function nodeIsWithin(target: EventTarget | null, root: Node): boolean {
  return target instanceof Node && (target === root || root.contains(target));
}

function clearExternalPrompt(chrome: ExternalImageChrome): void {
  chrome.loadButton.hidden = true;
  chrome.blockedNotice.hidden = true;
  chrome.img.hidden = false;
}

function showInsecureImage(chrome: ExternalImageChrome): void {
  chrome.img.removeAttribute("src");
  chrome.img.hidden = true;
  chrome.loadButton.hidden = true;
  chrome.blockedNotice.hidden = false;
}

function showExternalOptIn(chrome: ExternalImageChrome, host: string): void {
  chrome.img.removeAttribute("src");
  chrome.img.hidden = true;
  chrome.blockedNotice.hidden = true;
  chrome.loadButton.hidden = false;
  chrome.loadButton.textContent = `Load external image (${host})`;
}

function assignImageSrc(chrome: ExternalImageChrome, src: string): void {
  clearExternalPrompt(chrome);
  chrome.img.src = src;
}

function applyStaticAttrs(dom: HTMLImageElement, node: ProseMirrorNode): void {
  const alt = typeof node.attrs.alt === "string" ? node.attrs.alt : "";
  const title = typeof node.attrs.title === "string" ? node.attrs.title : "";
  dom.alt = alt;
  if (title) dom.title = title;
  else dom.removeAttribute("title");
}

/**
 * DOM `src` is a `blob:` display URL for `drive:fn-`, or https only after the
 * reader opts in. Document attrs stay `drive:fn-` / http(s). Plain http never
 * loads. The opt-in is remembered on the editor in memory only.
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
  const loadButton = document.createElement("button");
  loadButton.type = "button";
  loadButton.className = "text-editor-image__external-load";
  loadButton.hidden = true;
  const blockedNotice = document.createElement("div");
  blockedNotice.className = "text-editor-image__external-blocked";
  blockedNotice.textContent = INSECURE_IMAGE_BLOCKED_TEXT;
  blockedNotice.hidden = true;
  const chrome: ExternalImageChrome = { img, loadButton, blockedNotice };
  const deleteHost = document.createElement("div");
  deleteHost.className = "text-editor-image__delete-host";
  wrapper.append(img, loadButton, blockedNotice, deleteHost);

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
      clearExternalPrompt(chrome);
      return;
    }
    if (isInsecureHttpImageSrc(src)) {
      revoke();
      showInsecureImage(chrome);
      return;
    }
    const host = httpsImageHost(src);
    if (host) {
      revoke();
      if (hasExternalImageOptIn(editor, src)) assignImageSrc(chrome, src);
      else showExternalOptIn(chrome, host);
      return;
    }
    if (src.startsWith("data:")) {
      revoke();
      assignImageSrc(chrome, src);
      return;
    }

    const nodeId = parseDriveFnSrc(src);
    if (!nodeId) {
      revoke();
      img.removeAttribute("src");
      clearExternalPrompt(chrome);
      return;
    }

    revoke();
    img.removeAttribute("src");
    clearExternalPrompt(chrome);
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

  loadButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const src = typeof currentNode.attrs.src === "string" ? currentNode.attrs.src.trim() : "";
    if (!httpsImageHost(src)) return;
    rememberExternalImageOptIn(editor, src);
    revoke();
    assignImageSrc(chrome, src);
  });

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
      return (
        nodeIsWithin(target, deleteHost) ||
        nodeIsWithin(target, loadButton) ||
        nodeIsWithin(target, blockedNotice)
      );
    },
    destroy() {
      cancelled = true;
      token += 1;
      deleteRoot?.unmount();
      deleteRoot = null;
      revoke();
    },
    ignoreMutation(mutation) {
      if (
        nodeIsWithin(mutation.target, deleteHost) ||
        nodeIsWithin(mutation.target, loadButton) ||
        nodeIsWithin(mutation.target, blockedNotice)
      ) {
        return true;
      }
      return (
        mutation.type === "attributes" &&
        mutation.target === img &&
        (mutation.attributeName === "src" || mutation.attributeName === "hidden")
      );
    },
  };
}
