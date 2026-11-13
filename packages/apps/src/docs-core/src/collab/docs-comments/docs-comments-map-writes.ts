import type { Editor } from "@tiptap/react";
import {
  findAnchorOccurrenceAtRange,
  findCommentMarkIdInSelection,
  readSelectedAnchorText,
} from "@/text-editor-core/src/text-editor-comment-commands";
import {
  createDocsCommentId,
  getDocsCommentsMap,
  parseDocsCommentThread,
} from "../docs-comments-map";
import type {
  DocsCommentAuthor,
  DocsCommentMessage,
  DocsCommentReaction,
  DocsCommentThread,
} from "@/text-editor-core/docs-collab/docs-comments-types";
import type * as Y from "yjs";

export function buildDraftThreadFromSelection(
  editor: Editor,
  currentUser: DocsCommentAuthor,
): DocsCommentThread | null {
  const { from, to, empty } = editor.state.selection;
  if (empty) return null;

  const anchorText = readSelectedAnchorText(editor);
  if (!anchorText) return null;

  return {
    id: createDocsCommentId(),
    anchorText,
    anchorFrom: from,
    anchorTo: to,
    anchorOccurrence: findAnchorOccurrenceAtRange(editor.state.doc, anchorText, from, to),
    createdAt: new Date().toISOString(),
    createdBy: currentUser,
    resolved: false,
    messages: [],
  };
}

export function normalizeDocsCommentAuthor(author: DocsCommentAuthor): DocsCommentAuthor {
  const name = author.name?.trim() || author.id?.trim() || "Unknown";
  return name === author.name ? author : { ...author, name };
}

export function createCommentMessage(
  body: string,
  author: DocsCommentAuthor,
): DocsCommentMessage | null {
  const trimmed = body.trim();
  if (!trimmed) return null;

  return {
    id: createDocsCommentId(),
    body: trimmed,
    createdAt: new Date().toISOString(),
    author: normalizeDocsCommentAuthor(author),
  };
}

export function persistDraftThreadFirstReply(
  ydoc: Y.Doc,
  draft: DocsCommentThread,
  message: DocsCommentMessage,
): void {
  getDocsCommentsMap(ydoc).set(draft.id, {
    ...draft,
    messages: [message],
  });
}

export function appendCommentReply(
  ydoc: Y.Doc,
  threadId: string,
  message: DocsCommentMessage,
): boolean {
  const map = getDocsCommentsMap(ydoc);
  const existing = parseDocsCommentThread(map.get(threadId), threadId);
  if (!existing || existing.resolved) return false;

  map.set(threadId, {
    ...existing,
    messages: [...existing.messages, message],
  });
  return true;
}

export function toggleCommentThreadReaction(
  ydoc: Y.Doc,
  threadId: string,
  userId: string,
  emoji: string,
): boolean {
  if (!emoji) return false;

  const map = getDocsCommentsMap(ydoc);
  const existing = parseDocsCommentThread(map.get(threadId), threadId);
  if (!existing || existing.resolved) return false;

  const reactions = [...(existing.reactions ?? [])];
  const index = reactions.findIndex((reaction) => reaction.emoji === emoji);

  if (index >= 0) {
    const next = toggleUserOnReaction(reactions[index]!, userId, emoji);
    if (next) {
      reactions[index] = next;
    } else {
      reactions.splice(index, 1);
    }
  } else {
    reactions.push({ emoji, userIds: [userId] });
  }

  map.set(threadId, {
    ...existing,
    reactions: reactions.length > 0 ? reactions : undefined,
  });
  return true;
}

function toggleUserOnReaction(
  reaction: DocsCommentReaction,
  userId: string,
  emoji: string,
): DocsCommentReaction | null {
  if (reaction.userIds.includes(userId)) {
    const userIds = reaction.userIds.filter((id) => id !== userId);
    return userIds.length > 0 ? { emoji, userIds } : null;
  }
  return { emoji, userIds: [...reaction.userIds, userId] };
}

export function resolveCommentThread(ydoc: Y.Doc, threadId: string): DocsCommentThread | null {
  const map = getDocsCommentsMap(ydoc);
  const existing = parseDocsCommentThread(map.get(threadId), threadId);
  if (!existing) return null;

  map.set(threadId, { ...existing, resolved: true });
  return existing;
}

export function deletePersistedCommentThread(ydoc: Y.Doc, threadId: string): void {
  getDocsCommentsMap(ydoc).delete(threadId);
}

export function selectionOverlapsOpenComment(editor: Editor, openThreadIds: Set<string>): boolean {
  return Boolean(findCommentMarkIdInSelection(editor, { allowedIds: openThreadIds }));
}
