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
const LOAD_EXTERNAL_IMAGE_PREFIX = "Load external image";

type ExternalImageOptIn = {
  hosts: Set<string>;
  refresh: Set<() => void>;
};

/** Reader opt-in for one https host. Keyed by the editor so it dies with that document. */
const externalImageOptInByEditor = new WeakMap<Editor, ExternalImageOptIn>();

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

function externalImageOptIn(editor: Editor): ExternalImageOptIn {
  let state = externalImageOptInByEditor.get(editor);
  if (!state) {
    state = { hosts: new Set(), refresh: new Set() };
    externalImageOptInByEditor.set(editor, state);
  }
  return state;
}

function rememberExternalImageOptIn(editor: Editor, host: string): void {
  const state = externalImageOptIn(editor);
  state.hosts.add(host);
  for (const refresh of state.refresh) refresh();
}

function hasExternalImageOptIn(editor: Editor, host: string): boolean {
  return externalImageOptInByEditor.get(editor)?.hosts.has(host) ?? false;
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

type ExternalImagePrompt =
  | { kind: "empty" }
  | { kind: "insecure" }
  | { kind: "https"; host: string }
  | { kind: "drive"; nodeId: string }
  | { kind: "unsupported" };

function nodeImageSrc(node: ProseMirrorNode): string {
  return typeof node.attrs.src === "string" ? node.attrs.src.trim() : "";
}

/** One classification of a stored src, shared by the first paint and a later relabel. */
function externalImagePrompt(src: string): ExternalImagePrompt {
  if (!src) return { kind: "empty" };
  if (isInsecureHttpImageSrc(src)) return { kind: "insecure" };
  const host = httpsImageHost(src);
  if (host) return { kind: "https", host };
  const nodeId = parseDriveFnSrc(src);
  if (!nodeId) return { kind: "unsupported" };
  return { kind: "drive", nodeId };
}

function nodeIsWithin(target: EventTarget | null, root: Node): boolean {
  return target instanceof Node && (target === root || root.contains(target));
}

function clearExternalPrompt(chrome: ExternalImageChrome): void {
  chrome.loadButton.hidden = true;
  chrome.blockedNotice.hidden = true;
  chrome.img.hidden = false;
}

function imageAlt(node: ProseMirrorNode): string {
  return typeof node.attrs.alt === "string" ? node.attrs.alt.trim() : "";
}

function loadExternalImageLabel(alt: string, host: string): string {
  return alt
    ? `${LOAD_EXTERNAL_IMAGE_PREFIX}: ${alt} (${host})`
    : `${LOAD_EXTERNAL_IMAGE_PREFIX} (${host})`;
}

function insecureImageLabel(alt: string): string {
  return alt ? `${INSECURE_IMAGE_BLOCKED_TEXT}: ${alt}` : INSECURE_IMAGE_BLOCKED_TEXT;
}

function showInsecureImage(chrome: ExternalImageChrome, alt: string): void {
  chrome.img.removeAttribute("src");
  chrome.img.hidden = true;
  chrome.loadButton.hidden = true;
  chrome.blockedNotice.hidden = false;
  chrome.blockedNotice.textContent = insecureImageLabel(alt);
}

function showExternalOptIn(chrome: ExternalImageChrome, alt: string, host: string): void {
  chrome.img.removeAttribute("src");
  chrome.img.hidden = true;
  chrome.blockedNotice.hidden = true;
  chrome.loadButton.hidden = false;
  chrome.loadButton.textContent = loadExternalImageLabel(alt, host);
}

function assignImageSrc(chrome: ExternalImageChrome, src: string): void {
  clearExternalPrompt(chrome);
  chrome.img.src = src;
}

/** Relabel a prompt that is already on screen. Does not fetch or assign `src`. */
function relabelVisiblePrompt(chrome: ExternalImageChrome, src: string, alt: string): void {
  const prompt = externalImagePrompt(src);
  if (prompt.kind === "https" && !chrome.loadButton.hidden) {
    showExternalOptIn(chrome, alt, prompt.host);
    return;
  }
  if (prompt.kind === "insecure" && !chrome.blockedNotice.hidden) {
    showInsecureImage(chrome, alt);
  }
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
 * loads. The opt-in is the host, remembered on the editor in memory only.
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
    const src = nodeImageSrc(next);
    const prompt = externalImagePrompt(src);
    const alt = imageAlt(next);
    const generation = ++token;
    cancelled = false;

    if (prompt.kind === "insecure") {
      revoke();
      showInsecureImage(chrome, alt);
      return;
    }
    if (prompt.kind === "https") {
      revoke();
      if (hasExternalImageOptIn(editor, prompt.host)) assignImageSrc(chrome, src);
      else showExternalOptIn(chrome, alt, prompt.host);
      return;
    }
    if (prompt.kind !== "drive") {
      revoke();
      img.removeAttribute("src");
      clearExternalPrompt(chrome);
      return;
    }

    const nodeId = prompt.nodeId;
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

  // One click allows the host for every image already mounted in this editor.
  const refreshOptIn = () => {
    const src = nodeImageSrc(currentNode);
    const prompt = externalImagePrompt(src);
    if (prompt.kind !== "https" || !hasExternalImageOptIn(editor, prompt.host)) return;
    if (img.getAttribute("src") === src) return;
    revoke();
    assignImageSrc(chrome, src);
  };
  const optIn = externalImageOptIn(editor);
  optIn.refresh.add(refreshOptIn);

  loadButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const src = nodeImageSrc(currentNode);
    const prompt = externalImagePrompt(src);
    if (prompt.kind !== "https") return;
    rememberExternalImageOptIn(editor, prompt.host);
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
        relabelVisiblePrompt(chrome, nodeImageSrc(updated), imageAlt(updated));
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
      optIn.refresh.delete(refreshOptIn);
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
