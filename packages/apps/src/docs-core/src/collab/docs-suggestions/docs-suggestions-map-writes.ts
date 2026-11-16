import type * as Y from "yjs";
import { getDocsSuggestionThreadsMap, parseDocsSuggestionThread } from "../docs-suggestions-map";
import type {
  DocsCommentMessage,
  DocsCommentReaction,
} from "@/text-editor-core/docs-collab/docs-comments-types";
import { createCommentMessage } from "../docs-comments/docs-comments-map-writes";

export { createCommentMessage };

export function appendSuggestionReply(
  ydoc: Y.Doc,
  changeId: string,
  message: DocsCommentMessage,
): boolean {
  const map = getDocsSuggestionThreadsMap(ydoc);
  const existing = parseDocsSuggestionThread(map.get(changeId), changeId);

  map.set(changeId, {
    messages: [...(existing?.messages ?? []), message],
    reactions: existing?.reactions,
  });
  return true;
}

export function toggleSuggestionThreadReaction(
  ydoc: Y.Doc,
  changeId: string,
  userId: string,
  emoji: string,
): boolean {
  if (!emoji) return false;

  const map = getDocsSuggestionThreadsMap(ydoc);
  const existing = parseDocsSuggestionThread(map.get(changeId), changeId);

  const reactions = [...(existing?.reactions ?? [])];
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

  map.set(changeId, {
    messages: existing?.messages ?? [],
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

export function deleteSuggestionThread(ydoc: Y.Doc, changeId: string): void {
  getDocsSuggestionThreadsMap(ydoc).delete(changeId);
}

export function pruneOrphanSuggestionThreads(ydoc: Y.Doc, activeChangeIds: Set<string>): void {
  const map = getDocsSuggestionThreadsMap(ydoc);
  map.forEach((_, key) => {
    if (!activeChangeIds.has(key)) {
      map.delete(key);
    }
  });
}
