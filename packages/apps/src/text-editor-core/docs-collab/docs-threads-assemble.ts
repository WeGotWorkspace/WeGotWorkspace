import type { DocsCommentThread } from "./docs-comments-types";
import type { DocsSuggestionThread, DocsSuggestionWithThread } from "./docs-suggestions-types";
import type { DocsFileThread } from "./docs-threads-types";

export function docsFileThreadToComment(thread: DocsFileThread): DocsCommentThread {
  return {
    id: thread.id,
    anchorText: thread.anchorText,
    anchorFrom: thread.anchorFrom ?? undefined,
    anchorTo: thread.anchorTo ?? undefined,
    anchorOccurrence: thread.anchorOccurrence ?? undefined,
    createdAt: thread.createdAt,
    createdBy: thread.createdBy,
    resolved: thread.resolved,
    messages: thread.messages,
    reactions: thread.reactions.length > 0 ? thread.reactions : undefined,
  };
}

export function docsFileThreadToSuggestion(thread: DocsFileThread): DocsSuggestionThread {
  return {
    changeId: thread.changeId ?? thread.id,
    messages: thread.messages.filter((message) => message.body.trim() !== ""),
    reactions: thread.reactions.length > 0 ? thread.reactions : undefined,
  };
}

/** Journal-only card for Resolved — no live track-change group required. */
export function docsFileThreadToArchivedSuggestion(
  thread: DocsFileThread,
): DocsSuggestionWithThread {
  const messages = thread.messages.filter((message) => message.body.trim() !== "");
  const from = thread.anchorFrom ?? Number.MAX_SAFE_INTEGER;
  return {
    changeId: thread.changeId ?? thread.id,
    authorName: thread.createdBy.name,
    authorColor: "",
    timestamp: thread.createdAt,
    from,
    to: thread.anchorTo ?? from,
    anchorText: thread.anchorText,
    summary: thread.anchorText,
    parts: [],
    messages,
    reactions: thread.reactions.length > 0 ? thread.reactions : undefined,
    archived: true,
  };
}

export function suggestionThreadToDocsFile(
  thread: DocsSuggestionThread,
  path: string,
): DocsFileThread {
  const first = thread.messages[0];
  return {
    id: thread.changeId,
    kind: "suggestion",
    path,
    changeId: thread.changeId,
    anchorText: "",
    anchorFrom: null,
    anchorTo: null,
    anchorOccurrence: null,
    createdAt: first?.createdAt ?? new Date().toISOString(),
    createdBy: first?.author ?? { id: "", name: "" },
    resolved: false,
    archived: false,
    messages: thread.messages,
    reactions: thread.reactions ?? [],
  };
}

export function commentThreadToDocsFile(thread: DocsCommentThread, path: string): DocsFileThread {
  return {
    id: thread.id,
    kind: "comment",
    path,
    changeId: null,
    anchorText: thread.anchorText,
    anchorFrom: thread.anchorFrom ?? null,
    anchorTo: thread.anchorTo ?? null,
    anchorOccurrence: thread.anchorOccurrence ?? null,
    createdAt: thread.createdAt,
    createdBy: thread.createdBy,
    resolved: thread.resolved,
    archived: false,
    messages: thread.messages,
    reactions: thread.reactions ?? [],
  };
}

export function splitDocsFileThreads(threads: DocsFileThread[]): {
  comments: DocsCommentThread[];
  suggestions: DocsSuggestionThread[];
  archivedSuggestions: DocsSuggestionWithThread[];
} {
  const comments: DocsCommentThread[] = [];
  const suggestions: DocsSuggestionThread[] = [];
  const archivedSuggestions: DocsSuggestionWithThread[] = [];
  for (const thread of threads) {
    if (thread.kind === "suggestion") {
      if (thread.archived) {
        archivedSuggestions.push(docsFileThreadToArchivedSuggestion(thread));
      } else {
        suggestions.push(docsFileThreadToSuggestion(thread));
      }
      continue;
    }
    comments.push(docsFileThreadToComment(thread));
  }
  return { comments, suggestions, archivedSuggestions };
}
