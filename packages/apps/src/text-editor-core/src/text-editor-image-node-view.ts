import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { Editor, NodeViewRendererProps } from "@tiptap/core";
import type { ViewMutationRecord } from "@tiptap/pm/view";
import type { DocsImageContentFetcher } from "@/text-editor-core/src/text-editor-image-content";
import { setDocsImageLayoutAt } from "@/text-editor-core/src/text-editor-image-commands";
import {
  DOCS_IMAGE_MIN_WIDTH,
  DOCS_IMAGE_LIVE_WIDTH_EVENT,
  normalizeDocsImageAlign,
  normalizeDocsImageCaption,
  normalizeDocsImageHref,
  normalizeDocsImageWidth,
  type DocsImageAlign,
} from "@/text-editor-core/src/text-editor-image-attrs";
import { isHttpImageSrc, parseDriveFnSrc } from "@/text-editor-core/src/text-editor-image-src";
import {
  forgetShownImageBlob,
  rememberShownImageBlob,
} from "@/text-editor-core/src/text-editor-image-shown-blob";

/**
 * Keyboard or pointer last? A selected image only draws its ring after the keyboard (the
 * `:focus-visible` rule), never after a click. One listener pair for the whole page.
 */
let lastInputWasKeyboard = false;
let modalityTracked = false;
function trackInputModality(): void {
  if (modalityTracked || typeof document === "undefined") return;
  modalityTracked = true;
  document.addEventListener("keydown", () => (lastInputWasKeyboard = true), true);
  document.addEventListener("pointerdown", () => (lastInputWasKeyboard = false), true);
  document.addEventListener("mousedown", () => (lastInputWasKeyboard = false), true);
}

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
  dom.alt = alt;
  // The title is the caption under the picture, not a tooltip too.
  dom.removeAttribute("title");
}

export const DOCS_IMAGE_CAPTION_PLACEHOLDER = "Add a caption";

/** Width and alignment as the page shows them (`null` keeps the picture's own size). */
function applyLayout(wrapper: HTMLElement, img: HTMLImageElement, node: ProseMirrorNode): void {
  const width = normalizeDocsImageWidth(node.attrs.width);
  const align = normalizeDocsImageAlign(node.attrs.align) ?? "start";
  wrapper.dataset.align = align;
  wrapper.dataset.linked = normalizeDocsImageHref(node.attrs.href) ? "true" : "false";
  wrapper.style.width = width == null ? "" : `${width}%`;
  img.style.width = width == null ? "" : "100%";
}

/** What a `%` width resolves against: the parent's content box, without its padding. */
function contentBoxWidth(element: HTMLElement): number {
  const style = getComputedStyle(element);
  const padding = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
  return Math.max(1, element.clientWidth - (Number.isFinite(padding) ? padding : 0));
}

/**
 * Drag a side handle: the new width as % of the text column. Relative to where the drag
 * started (the pointer rarely lands exactly on the edge, so nothing jumps). Centered
 * images grow on both sides, so the edge moves at half the width change; start/end
 * images keep their own edge still.
 */
export function dragWidthPercent(options: {
  startX: number;
  clientX: number;
  /** Which edge's handle: `start` / `end` of the writing direction. */
  side: "start" | "end";
  rtl?: boolean;
  align: DocsImageAlign;
  /** Width of the picture in px when the drag started. */
  startWidth: number;
  columnWidth: number;
}): number {
  const { startX, clientX, side, align, startWidth, columnWidth, rtl = false } = options;
  // The end edge is on the right in LTR and on the left in RTL; outward is away from the centre.
  const outward = (side === "end") !== rtl ? clientX - startX : startX - clientX;
  const px = startWidth + outward * (align === "center" ? 2 : 1);
  const percent = Math.round((px / Math.max(1, columnWidth)) * 100);
  return Math.min(100, Math.max(DOCS_IMAGE_MIN_WIDTH, percent));
}

/**
 * DOM `src` is a `blob:` display URL for `drive:fn-`, or https only after the
 * reader opts in. Document attrs stay `drive:fn-` / http(s). Plain http never
 * loads. The opt-in is the host, remembered on the editor in memory only.
 * Width, alignment and caption are node attrs. The floating image bar (not this view) offers
 * size presets, alignment, replace and delete; this view draws them, owns the side drag handles
 * and the editable caption.
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
  const frame = document.createElement("div");
  frame.className = "text-editor-image__frame";
  const handles = (["start", "end"] as const).map((side) => {
    const handle = document.createElement("div");
    handle.className = `text-editor-image__handle text-editor-image__handle--${side} no-print`;
    handle.dataset.side = side;
    return handle;
  });
  frame.append(img, loadButton, blockedNotice, ...handles);
  const caption = document.createElement("div");
  caption.className = "text-editor-image__caption";
  caption.dataset.placeholder = DOCS_IMAGE_CAPTION_PLACEHOLDER;
  wrapper.append(frame, caption);

  let objectUrl: string | undefined;
  let cancelled = false;
  let token = 0;
  let currentNode = props.node;

  const revoke = () => {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = undefined;
    }
    forgetShownImageBlob(img);
  };

  trackInputModality();
  const announceLiveWidth = (width: number | null) =>
    wrapper.dispatchEvent(
      new CustomEvent(DOCS_IMAGE_LIVE_WIDTH_EVENT, { bubbles: true, detail: { width } }),
    );
  let selected = false;
  /** Ends the drag in progress (if any): commits the width, or drops it. */
  let endDrag: ((commit: boolean) => void) | null = null;
  const syncChrome = () => {
    wrapper.classList.toggle("ProseMirror-selectednode", selected);
    wrapper.dataset.focused = selected || document.activeElement === caption ? "true" : "false";
    if (!selected) wrapper.dataset.focusVisible = "false";
    wrapper.dataset.editable = editor.isEditable ? "true" : "false";
    caption.contentEditable = editor.isEditable ? "true" : "false";
  };

  const syncCaption = (node: ProseMirrorNode) => {
    const text = normalizeDocsImageCaption(node.attrs.title) ?? "";
    // Never rewrite the line the person is typing in.
    if (document.activeElement !== caption && caption.textContent !== text) {
      caption.textContent = text;
    }
  };

  const pos = () => {
    const at = getPos();
    return typeof at === "number" ? at : null;
  };

  const commitCaption = () => {
    const at = pos();
    if (at == null || !editor.isEditable) return;
    const next = normalizeDocsImageCaption(caption.textContent);
    if (next === normalizeDocsImageCaption(currentNode.attrs.title)) return;
    setDocsImageLayoutAt(editor, at, { title: next });
  };
  // A linked picture opens its link for readers; editors click to select it.
  img.addEventListener("click", () => {
    const href = normalizeDocsImageHref(currentNode.attrs.href);
    if (href && !editor.isEditable) window.open(href, "_blank", "noopener,noreferrer");
  });
  caption.addEventListener("input", commitCaption);
  caption.addEventListener("focus", syncChrome);
  caption.addEventListener("blur", () => {
    commitCaption();
    const text = normalizeDocsImageCaption(currentNode.attrs.title) ?? "";
    if (caption.textContent !== text) caption.textContent = text;
    syncChrome();
  });
  caption.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== "Escape") return;
    event.preventDefault();
    const at = pos();
    caption.blur();
    if (at != null) editor.chain().setNodeSelection(at).focus().run();
  });
  caption.addEventListener("paste", (event) => {
    event.preventDefault();
    const text = event.clipboardData?.getData("text/plain") ?? "";
    document.execCommand("insertText", false, text.replace(/\s+/g, " "));
  });

  for (const handle of handles) {
    handle.addEventListener("pointerdown", (event) => {
      if (!editor.isEditable || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const side = handle.dataset.side === "start" ? "start" : "end";
      const rtl = getComputedStyle(wrapper).direction === "rtl";
      const align = normalizeDocsImageAlign(currentNode.attrs.align) ?? "start";
      const columnWidth = contentBoxWidth(wrapper.parentElement ?? wrapper);
      const startWidth = frame.getBoundingClientRect().width;
      const startX = event.clientX;
      let width = normalizeDocsImageWidth(currentNode.attrs.width);
      endDrag?.(false);
      try {
        handle.setPointerCapture(event.pointerId);
      } catch {
        // Capture is a nicety; the window listeners below carry the drag.
      }
      // Window-level, so the drag ends wherever the pointer is released, and also when the
      // release was never delivered (outside the window, lost capture, a re-render):
      // any move without a pressed button ends it too.
      const controller = new AbortController();
      const { signal } = controller;
      const move = (moveEvent: PointerEvent) => {
        if (moveEvent.buttons === 0) return end(true);
        width = dragWidthPercent({
          startX,
          clientX: moveEvent.clientX,
          side,
          rtl,
          align,
          startWidth,
          columnWidth,
        });
        wrapper.style.width = `${width}%`;
        img.style.width = "100%";
        announceLiveWidth(width);
      };
      const end = (commit: boolean) => {
        controller.abort();
        if (endDrag === end) endDrag = null;
        const at = pos();
        if (commit && at != null && width != null) setDocsImageLayoutAt(editor, at, { width });
        else applyLayout(wrapper, img, currentNode);
        announceLiveWidth(null);
      };
      endDrag = end;
      window.addEventListener("pointermove", move, { signal });
      window.addEventListener("pointerup", () => end(true), { signal });
      window.addEventListener("pointercancel", () => end(false), { signal });
      window.addEventListener("blur", () => end(true), { signal });
      handle.addEventListener("lostpointercapture", () => end(true), { signal });
    });
  }

  const resolveSrc = (next: ProseMirrorNode) => {
    applyStaticAttrs(img, next);
    const src = nodeImageSrc(next);
    const prompt = externalImagePrompt(src);
    const alt = imageAlt(next);
    const generation = ++token;
    cancelled = false;
    delete img.dataset.loading;

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
    // Print waits for images marked as loading (see `text-editor-print.ts`).
    img.dataset.loading = "true";
    void (async () => {
      try {
        const blob = await fetchContent(nodeId);
        if (cancelled || generation !== token) return;
        objectUrl = URL.createObjectURL(blob);
        rememberShownImageBlob(img, blob);
        img.src = objectUrl;
      } catch {
        if (cancelled || generation !== token) return;
        img.removeAttribute("src");
      } finally {
        if (generation === token) delete img.dataset.loading;
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

  applyLayout(wrapper, img, props.node);
  syncCaption(props.node);
  syncChrome();
  // A document opens read-only until it has joined; editability changes after this view exists.
  editor.on("transaction", syncChrome);
  editor.on("update", syncChrome);

  resolveSrc(props.node);

  return {
    dom: wrapper,
    update(updated) {
      if (updated.type !== currentNode.type) return false;
      const prevSrc = currentNode.attrs.src;
      currentNode = updated;
      applyLayout(wrapper, img, updated);
      syncCaption(updated);
      if (updated.attrs.src !== prevSrc) {
        resolveSrc(updated);
      } else {
        applyStaticAttrs(img, updated);
        relabelVisiblePrompt(chrome, nodeImageSrc(updated), imageAlt(updated));
      }
      return true;
    },
    selectNode() {
      selected = true;
      wrapper.dataset.focusVisible = lastInputWasKeyboard ? "true" : "false";
      syncChrome();
    },
    deselectNode() {
      selected = false;
      syncChrome();
    },
    stopEvent(event) {
      const target = event.target;
      return (
        nodeIsWithin(target, caption) ||
        handles.some((handle) => nodeIsWithin(target, handle)) ||
        nodeIsWithin(target, loadButton) ||
        nodeIsWithin(target, blockedNotice)
      );
    },
    destroy() {
      editor.off("transaction", syncChrome);
      editor.off("update", syncChrome);
      endDrag?.(false);
      cancelled = true;
      token += 1;
      optIn.refresh.delete(refreshOptIn);
      revoke();
    },
    ignoreMutation(mutation) {
      if (
        nodeIsWithin(mutation.target, caption) ||
        mutation.target === wrapper ||
        mutation.target === frame ||
        nodeIsWithin(mutation.target, loadButton) ||
        nodeIsWithin(mutation.target, blockedNotice)
      ) {
        return true;
      }
      return (
        mutation.type === "attributes" &&
        mutation.target === img &&
        // `data-loading` is ours too (print waits on it); not a document change.
        (mutation.attributeName === "src" ||
          mutation.attributeName === "hidden" ||
          mutation.attributeName === "data-loading")
      );
    },
  };
}
