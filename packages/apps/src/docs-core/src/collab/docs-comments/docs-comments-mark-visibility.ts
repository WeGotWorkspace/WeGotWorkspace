import type { Editor } from "@tiptap/react";
import { escapeCommentIdForSelector } from "@/text-editor-core/src/text-editor-comment-commands";
import { escapeTrackChangeIdForSelector } from "@/text-editor-core/src/text-editor-track-changes";
import type { DocsCommentThread } from "@/text-editor-core/docs-collab/docs-comments-types";
import {
  ensureCommentViewTimelinePolyfill,
  supportsCommentViewTimeline,
  usesCommentViewTimelinePolyfill,
} from "./docs-comments-view-timeline-polyfill";

export const DOCS_COMMENT_SCROLLPORT_SELECTOR = ".text-editor-sheet--fill";
export const DOCS_COMMENT_VIEW_TIMELINE_STYLE_ID = "docs-comments-view-timeline-styles";

/** Scroll-linked fade range — keep in sync with docs-comments-floating-layer.css */
export const DOCS_COMMENT_CARD_VISIBILITY_ANIMATION_RANGE = "entry 0% exit 100%";

export type DocsCommentVisibilityMode = "timeline" | "observer" | "static";

export type CollabMarkKind = "comment" | "suggestion";

export type CollabMarkIds = {
  comment: readonly string[];
  suggestion: readonly string[];
};

type CollabMarkKindConfig = {
  markAttribute: "data-comment-id" | "data-change-id";
  viewTimelineName: (id: string) => `--docs-cmt-${string}` | `--docs-sug-${string}`;
  escapeIdForSelector: (id: string) => string;
  cardTimelineSelectors: (escapedId: string) => string[];
};

const COLLAB_MARK_KINDS: CollabMarkKind[] = ["comment", "suggestion"];

export function collabMarkIds(
  threadIds: readonly string[] = [],
  changeIds: readonly string[] = [],
): CollabMarkIds {
  return { comment: threadIds, suggestion: changeIds };
}

/** Stable view-timeline name for a comment thread mark. */
export function commentViewTimelineName(threadId: string): `--docs-cmt-${string}` {
  const safe = threadId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `--docs-cmt-${safe}`;
}

/** Stable view-timeline name for a suggestion track-change mark. */
export function suggestionViewTimelineName(changeId: string): `--docs-sug-${string}` {
  const safe = changeId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `--docs-sug-${safe}`;
}

const COLLAB_MARK_KIND_CONFIG: Record<CollabMarkKind, CollabMarkKindConfig> = {
  comment: {
    markAttribute: "data-comment-id",
    viewTimelineName: commentViewTimelineName,
    escapeIdForSelector: escapeCommentIdForSelector,
    cardTimelineSelectors: (escapedId) => [
      `.docs-comments-floating-layer[data-visibility-mode="timeline"] .docs-comments-floating-layer__card[data-thread-id="${escapedId}"]`,
    ],
  },
  suggestion: {
    markAttribute: "data-change-id",
    viewTimelineName: suggestionViewTimelineName,
    escapeIdForSelector: escapeTrackChangeIdForSelector,
    cardTimelineSelectors: (_escapedId) => [],
  },
};

export function findDocsCommentScrollport(editor: Editor): HTMLElement | null {
  if (editor.isDestroyed) return null;
  return editor.view.dom.closest(DOCS_COMMENT_SCROLLPORT_SELECTOR) as HTMLElement | null;
}

export function resolveThreadDocumentPosition(editor: Editor, thread: DocsCommentThread): number {
  if (typeof thread.anchorFrom === "number") return thread.anchorFrom;

  const mark = editor.view.dom.querySelector(
    `[data-comment-id="${escapeCommentIdForSelector(thread.id)}"]`,
  );
  if (!mark) return Number.MAX_SAFE_INTEGER;

  try {
    return editor.view.posAtDOM(mark, 0);
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

/** Order floating cards to match document flow (top-to-bottom). */
export function sortThreadsByDocumentOrder(
  editor: Editor,
  threads: DocsCommentThread[],
): DocsCommentThread[] {
  return [...threads].sort((left, right) => {
    const leftPos = resolveThreadDocumentPosition(editor, left);
    const rightPos = resolveThreadDocumentPosition(editor, right);
    if (leftPos !== rightPos) return leftPos - rightPos;
    return left.id.localeCompare(right.id);
  });
}

export { supportsCommentViewTimeline };

export function prefersReducedCommentMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function resolveCommentVisibilityMode(): DocsCommentVisibilityMode {
  if (prefersReducedCommentMotion()) return "static";
  if (supportsCommentViewTimeline()) return "timeline";
  return "observer";
}

export async function resolveCommentVisibilityModeAsync(): Promise<DocsCommentVisibilityMode> {
  if (prefersReducedCommentMotion()) return "static";
  if (supportsCommentViewTimeline()) return "timeline";
  const polyfillReady = await ensureCommentViewTimelinePolyfill();
  return polyfillReady ? "timeline" : "observer";
}

function buildCollabMarkTimelineRules(kind: CollabMarkKind, ids: readonly string[]): string[] {
  const config = COLLAB_MARK_KIND_CONFIG[kind];
  return ids.map((id) => {
    const selector = `[${config.markAttribute}="${config.escapeIdForSelector(id)}"]`;
    const name = config.viewTimelineName(id);
    return `${selector}{view-timeline-name:${name};view-timeline-axis:block;}`;
  });
}

function buildCollabCardTimelineRules(kind: CollabMarkKind, ids: readonly string[]): string[] {
  const config = COLLAB_MARK_KIND_CONFIG[kind];
  return ids.flatMap((id) => {
    const escapedId = config.escapeIdForSelector(id);
    const timelineName = config.viewTimelineName(id);
    const animationProps = `animation-timeline:${timelineName};animation-range:${DOCS_COMMENT_CARD_VISIBILITY_ANIMATION_RANGE};`;
    return config
      .cardTimelineSelectors(escapedId)
      .map((selector) => `${selector}{${animationProps}}`);
  });
}

export function buildCollabTimelineStylesheet(ids: CollabMarkIds): string {
  const hasMarks = COLLAB_MARK_KINDS.some((kind) => ids[kind].length > 0);
  if (!hasMarks) return "";

  const markRules = COLLAB_MARK_KINDS.flatMap((kind) =>
    buildCollabMarkTimelineRules(kind, ids[kind]),
  );
  const scopeRule = `${DOCS_COMMENT_SCROLLPORT_SELECTOR}{timeline-scope:${buildCollabTimelineScopeFromIds(ids)};}`;
  const cardRules = COLLAB_MARK_KINDS.flatMap((kind) =>
    buildCollabCardTimelineRules(kind, ids[kind]),
  );

  return [...markRules, scopeRule, ...cardRules].join("\n");
}

export function buildCommentViewTimelineStylesheet(
  threadIds: readonly string[],
  changeIds: readonly string[] = [],
): string {
  return buildCollabTimelineStylesheet(collabMarkIds(threadIds, changeIds));
}

function clearLegacyInlineViewTimelines(editor: Editor): void {
  editor.view.dom.querySelectorAll("[data-comment-id], [data-change-id]").forEach((node) => {
    const element = node as HTMLElement;
    element.style.removeProperty("view-timeline-name");
    element.style.removeProperty("view-timeline-axis");
  });

  findDocsCommentScrollport(editor)?.style.removeProperty("timeline-scope");
}

function applyCommentViewTimelineStylesheet(css: string): void {
  if (typeof document === "undefined") return;

  if (!css) {
    document.getElementById(DOCS_COMMENT_VIEW_TIMELINE_STYLE_ID)?.remove();
    return;
  }

  const replaceForPolyfill = usesCommentViewTimelinePolyfill();
  const existing = document.getElementById(
    DOCS_COMMENT_VIEW_TIMELINE_STYLE_ID,
  ) as HTMLStyleElement | null;

  if (replaceForPolyfill && existing?.isConnected) {
    const replacement = document.createElement("style");
    replacement.id = DOCS_COMMENT_VIEW_TIMELINE_STYLE_ID;
    replacement.textContent = css;
    existing.replaceWith(replacement);
    return;
  }

  const styleEl = existing ?? document.createElement("style");
  styleEl.id = DOCS_COMMENT_VIEW_TIMELINE_STYLE_ID;
  styleEl.textContent = css;
  if (!existing) document.head.append(styleEl);
}

/** Inject view-timeline stylesheet rules for marks, scope, and card animation-timeline. */
export function syncCollabViewTimelineStyles(editor: Editor, ids: CollabMarkIds): void {
  if (editor.isDestroyed) return;

  clearLegacyInlineViewTimelines(editor);
  applyCommentViewTimelineStylesheet(buildCollabTimelineStylesheet(ids));
}

/** Inject view-timeline stylesheet rules for marks, scope, and card animation-timeline. */
export function syncCommentViewTimelineStyles(
  editor: Editor,
  threadIds: readonly string[],
  changeIds: readonly string[] = [],
): void {
  syncCollabViewTimelineStyles(editor, collabMarkIds(threadIds, changeIds));
}

export function buildCommentTimelineScope(threadIds: readonly string[]): string {
  return buildCollabTimelineScope(threadIds, []);
}

function buildCollabTimelineScopeFromIds(ids: CollabMarkIds): string {
  return COLLAB_MARK_KINDS.flatMap((kind) =>
    ids[kind].map((id) => COLLAB_MARK_KIND_CONFIG[kind].viewTimelineName(id)),
  ).join(", ");
}

export function buildCollabTimelineScope(
  threadIds: readonly string[],
  changeIds: readonly string[],
): string {
  return buildCollabTimelineScopeFromIds(collabMarkIds(threadIds, changeIds));
}

export type CommentMarkVisibilityObserver = {
  disconnect: () => void;
  resync: () => void;
};

type ObserveCommentMarkVisibilityOptions = {
  rootMargin?: string;
  threshold?: number | number[];
};

function collectCollabMarksForKind(
  editor: Editor,
  kind: CollabMarkKind,
  ids: readonly string[],
): Map<string, Element> {
  const marks = new Map<string, Element>();
  if (editor.isDestroyed) return marks;

  const config = COLLAB_MARK_KIND_CONFIG[kind];
  for (const id of ids) {
    const mark = editor.view.dom.querySelector(
      `[${config.markAttribute}="${config.escapeIdForSelector(id)}"]`,
    );
    if (mark) marks.set(id, mark);
  }

  return marks;
}

function collectCollabMarks(editor: Editor, ids: CollabMarkIds): Map<string, Element> {
  return new Map(
    COLLAB_MARK_KINDS.flatMap((kind) => [...collectCollabMarksForKind(editor, kind, ids[kind])]),
  );
}

function getMarkIdFromElement(element: Element): string | null {
  return element.getAttribute("data-comment-id") ?? element.getAttribute("data-change-id");
}

/** Geometry check for static/reduced-motion and IO fallback initial sync. */
export function isCommentMarkInScrollport(mark: Element, scrollport: HTMLElement | null): boolean {
  if (!scrollport) return true;

  const markRect = mark.getBoundingClientRect();
  const rootRect = scrollport.getBoundingClientRect();

  return (
    markRect.bottom > rootRect.top &&
    markRect.top < rootRect.bottom &&
    markRect.right > rootRect.left &&
    markRect.left < rootRect.right
  );
}

export function syncCommentCardVisibilityFromMarks(
  marks: ReadonlyMap<string, Element>,
  scrollport: HTMLElement | null,
  getCardElement: (markId: string) => HTMLElement | undefined,
): void {
  for (const [id, mark] of marks) {
    const card = getCardElement(id);
    if (!card) continue;
    card.setAttribute(
      "data-in-view",
      isCommentMarkInScrollport(mark, scrollport) ? "true" : "false",
    );
  }
}

/** Geometry-only visibility sync for static (reduced-motion) mode. */
export function syncCollabMarkVisibility(
  editor: Editor,
  getCardElement: (markId: string) => HTMLElement | undefined,
  ids: CollabMarkIds,
): void {
  if (editor.isDestroyed) return;

  const scrollport = findDocsCommentScrollport(editor);
  const marks = collectCollabMarks(editor, ids);
  syncCommentCardVisibilityFromMarks(marks, scrollport, getCardElement);
}

/** Geometry-only visibility sync for static (reduced-motion) mode. */
export function syncCommentMarkVisibility(
  editor: Editor,
  getCardElement: (markId: string) => HTMLElement | undefined,
  threadIds: readonly string[],
  changeIds: readonly string[] = [],
): void {
  syncCollabMarkVisibility(editor, getCardElement, collabMarkIds(threadIds, changeIds));
}

function syncCollabCardScrollLinkedForKind(
  marks: ReadonlyMap<string, Element>,
  getCardElement: (markId: string) => HTMLElement | undefined,
  ids: readonly string[],
): void {
  for (const id of ids) {
    const card = getCardElement(id);
    if (!card) continue;

    if (!marks.has(id)) {
      card.setAttribute("data-scroll-linked", "false");
      card.removeAttribute("data-timeline-fallback");
      continue;
    }

    if (card.getAttribute("data-timeline-fallback") === "true") {
      card.setAttribute("data-scroll-linked", "false");
      continue;
    }

    card.setAttribute("data-scroll-linked", "true");
    card.removeAttribute("data-timeline-fallback");
  }
}

/** True when a card can bind to a document mark for scroll-driven visibility. */
export function syncCollabCardScrollLinkedState(
  editor: Editor,
  getCardElement: (markId: string) => HTMLElement | undefined,
  threadIds: readonly string[],
  changeIds: readonly string[] = [],
): void {
  if (editor.isDestroyed) return;

  const ids = collabMarkIds(threadIds, changeIds);
  const marks = collectCollabMarks(editor, ids);
  for (const kind of COLLAB_MARK_KINDS) {
    syncCollabCardScrollLinkedForKind(marks, getCardElement, ids[kind]);
  }
}

const BROKEN_TIMELINE_OPACITY_THRESHOLD = 0.05;

/**
 * Fail open when scroll-linked cards stay hidden despite their mark being in view
 * (broken animation-timeline binding or view-timeline support).
 */
export function failOpenBrokenTimelineCards(
  editor: Editor,
  getCardElement: (markId: string) => HTMLElement | undefined,
  threadIds: readonly string[],
  changeIds: readonly string[] = [],
): void {
  if (editor.isDestroyed || typeof window === "undefined") return;

  const scrollport = findDocsCommentScrollport(editor);
  const marks = collectCollabMarks(editor, collabMarkIds(threadIds, changeIds));

  for (const [id, mark] of marks) {
    const card = getCardElement(id);
    if (!card || card.getAttribute("data-scroll-linked") !== "true") continue;
    if (!isCommentMarkInScrollport(mark, scrollport)) continue;

    const opacity = Number.parseFloat(window.getComputedStyle(card).opacity);
    if (!Number.isNaN(opacity) && opacity > BROKEN_TIMELINE_OPACITY_THRESHOLD) continue;

    card.setAttribute("data-scroll-linked", "false");
    card.setAttribute("data-timeline-fallback", "true");
    card.setAttribute("data-in-view", "true");
  }
}

/**
 * Single sync entry for floating layers — timeline stylesheet, scroll-link state,
 * geometry visibility, and timeline fail-open.
 */
export function syncCollabCardsVisibility(
  editor: Editor,
  getCardElement: (markId: string) => HTMLElement | undefined,
  ids: CollabMarkIds,
  visibilityMode: DocsCommentVisibilityMode,
): void {
  if (editor.isDestroyed) return;

  syncCollabViewTimelineStyles(editor, ids);
  syncCollabCardScrollLinkedState(editor, getCardElement, ids.comment, ids.suggestion);
  syncCollabMarkVisibility(editor, getCardElement, ids);

  if (visibilityMode === "timeline") {
    failOpenBrokenTimelineCards(editor, getCardElement, ids.comment, ids.suggestion);
  }
}

/**
 * Fallback visibility driver when view-timeline is unavailable
 * (polyfill failed and `@supports not (animation-timeline: view())`).
 */
export function observeCollabMarkVisibility(
  editor: Editor,
  getCardElement: (markId: string) => HTMLElement | undefined,
  ids: CollabMarkIds,
  options: ObserveCommentMarkVisibilityOptions = {},
): CommentMarkVisibilityObserver {
  if (editor.isDestroyed) {
    return { disconnect: () => {}, resync: () => {} };
  }

  const scrollport = findDocsCommentScrollport(editor);
  let marks = collectCollabMarks(editor, ids);

  syncCommentCardVisibilityFromMarks(marks, scrollport, getCardElement);

  if (marks.size === 0 || typeof IntersectionObserver === "undefined") {
    return {
      disconnect: () => {},
      resync: () => {
        marks = collectCollabMarks(editor, ids);
        syncCommentCardVisibilityFromMarks(marks, scrollport, getCardElement);
      },
    };
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const id = getMarkIdFromElement(entry.target);
        if (!id) continue;
        const card = getCardElement(id);
        if (!card) continue;
        card.setAttribute("data-in-view", entry.isIntersecting ? "true" : "false");
      }
    },
    {
      root: scrollport,
      rootMargin: options.rootMargin ?? "0px",
      threshold: options.threshold ?? 0,
    },
  );

  const observeMarks = (nextMarks: ReadonlyMap<string, Element>) => {
    observer.disconnect();
    nextMarks.forEach((mark) => observer.observe(mark));
  };

  observeMarks(marks);

  return {
    disconnect: () => observer.disconnect(),
    resync: () => {
      marks = collectCollabMarks(editor, ids);
      syncCommentCardVisibilityFromMarks(marks, scrollport, getCardElement);
      observeMarks(marks);
    },
  };
}

/**
 * Fallback visibility driver when view-timeline is unavailable
 * (polyfill failed and `@supports not (animation-timeline: view())`).
 */
export function observeCommentMarkVisibility(
  editor: Editor,
  getCardElement: (markId: string) => HTMLElement | undefined,
  threadIds: readonly string[],
  changeIds: readonly string[] = [],
  options: ObserveCommentMarkVisibilityOptions = {},
): CommentMarkVisibilityObserver {
  return observeCollabMarkVisibility(
    editor,
    getCardElement,
    collabMarkIds(threadIds, changeIds),
    options,
  );
}

export function measureFloatingLayerContainerMaxHeight(
  topPx: number,
  footerElement: HTMLElement | null,
  bottomGapPx = 16,
  viewportHeight = typeof window !== "undefined" ? window.innerHeight : 0,
): number {
  const maxBottom =
    footerElement != null
      ? footerElement.getBoundingClientRect().top - bottomGapPx
      : viewportHeight - bottomGapPx;
  return Math.max(maxBottom - topPx, 0);
}
