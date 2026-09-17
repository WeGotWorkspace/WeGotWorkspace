import type { Editor } from "@tiptap/react";
import type { DocsCommentThread } from "../docs-comments-types";
import { resolveThreadDocumentPosition } from "../docs-comments/docs-comments-mark-visibility";
import type { DocsSuggestionWithThread } from "../docs-suggestions-types";

export type DocsCollabReviewInboxTab = "open" | "resolved";

export type DocsCollabReviewCommentItem = {
  type: "comment";
  thread: DocsCommentThread;
};

export type DocsCollabReviewSuggestionItem = {
  type: "suggestion";
  suggestion: DocsSuggestionWithThread;
};

export type DocsCollabReviewItem = DocsCollabReviewCommentItem | DocsCollabReviewSuggestionItem;

/** Unresolved threads, including in-progress drafts (no messages yet). */
export function isOpenReviewThread(thread: DocsCommentThread): boolean {
  return !thread.resolved;
}

export function isPersistedResolvedThread(thread: DocsCommentThread): boolean {
  return thread.resolved && thread.messages.length > 0;
}

export function isOpenReviewSuggestion(suggestion: DocsSuggestionWithThread): boolean {
  return !suggestion.archived;
}

export function isResolvedReviewSuggestion(suggestion: DocsSuggestionWithThread): boolean {
  return Boolean(suggestion.archived);
}

/** Open-tab size for the Review header badge — stable across Open / Resolved. */
export function countOpenReviewItems(
  threads: DocsCommentThread[],
  suggestions: DocsSuggestionWithThread[],
): number {
  return (
    threads.filter(isOpenReviewThread).length + suggestions.filter(isOpenReviewSuggestion).length
  );
}

function toReviewItems(
  threads: DocsCommentThread[],
  suggestions: DocsSuggestionWithThread[],
): DocsCollabReviewItem[] {
  return [
    ...threads.map((thread): DocsCollabReviewCommentItem => ({ type: "comment", thread })),
    ...suggestions.map(
      (suggestion): DocsCollabReviewSuggestionItem => ({ type: "suggestion", suggestion }),
    ),
  ];
}

function reviewItemRecency(item: DocsCollabReviewItem): string {
  if (item.type === "comment") {
    const last = item.thread.messages.at(-1);
    return last?.createdAt ?? item.thread.createdAt;
  }
  const last = item.suggestion.messages.at(-1);
  return last?.createdAt ?? item.suggestion.timestamp;
}

function reviewItemId(item: DocsCollabReviewItem): string {
  return item.type === "comment" ? item.thread.id : item.suggestion.changeId;
}

/** History inbox: most recently resolved/archived first (last message time). */
export function sortReviewItemsByRecency(
  threads: DocsCommentThread[],
  suggestions: DocsSuggestionWithThread[],
): DocsCollabReviewItem[] {
  return toReviewItems(threads, suggestions).sort((left, right) => {
    const cmp = reviewItemRecency(right).localeCompare(reviewItemRecency(left));
    if (cmp !== 0) return cmp;
    return reviewItemId(left).localeCompare(reviewItemId(right));
  });
}

/** Open = unresolved comments (+ draft) and pending suggestions; Resolved = resolved comments and archived suggestions. */
export function filterReviewItemsByTab(
  tab: DocsCollabReviewInboxTab,
  threads: DocsCommentThread[],
  suggestions: DocsSuggestionWithThread[],
  editor: Editor | null,
): DocsCollabReviewItem[] {
  if (tab === "resolved") {
    return sortReviewItemsByRecency(
      threads.filter(isPersistedResolvedThread),
      suggestions.filter(isResolvedReviewSuggestion),
    );
  }

  return sortReviewItemsByDocumentOrder(
    editor,
    threads.filter(isOpenReviewThread),
    suggestions.filter(isOpenReviewSuggestion),
  );
}

function resolveReviewItemDocumentPosition(
  editor: Editor | null,
  item: DocsCollabReviewItem,
): number {
  if (item.type === "comment") {
    if (editor) return resolveThreadDocumentPosition(editor, item.thread);
    if (typeof item.thread.anchorFrom === "number") return item.thread.anchorFrom;
    return Number.MAX_SAFE_INTEGER;
  }

  return item.suggestion.from;
}

function compareReviewItems(
  editor: Editor | null,
  left: DocsCollabReviewItem,
  right: DocsCollabReviewItem,
): number {
  const leftPos = resolveReviewItemDocumentPosition(editor, left);
  const rightPos = resolveReviewItemDocumentPosition(editor, right);
  if (leftPos !== rightPos) return leftPos - rightPos;

  if (left.type !== right.type) {
    return left.type === "comment" ? -1 : 1;
  }

  const leftId = left.type === "comment" ? left.thread.id : left.suggestion.changeId;
  const rightId = right.type === "comment" ? right.thread.id : right.suggestion.changeId;
  return leftId.localeCompare(rightId);
}

/** Merge comments and suggestions into one list ordered by document position. */
export function sortReviewItemsByDocumentOrder(
  editor: Editor | null,
  threads: DocsCommentThread[],
  suggestions: DocsSuggestionWithThread[],
): DocsCollabReviewItem[] {
  return toReviewItems(threads, suggestions).sort((left, right) =>
    compareReviewItems(editor, left, right),
  );
}
