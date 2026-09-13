import type { DocsCommentThread } from "./docs-comments-types";
import type { DocsSuggestionThread } from "./docs-suggestions-types";
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
} {
  const comments: DocsCommentThread[] = [];
  const suggestions: DocsSuggestionThread[] = [];
  for (const thread of threads) {
    if (thread.kind === "suggestion") {
      if (!thread.archived) suggestions.push(docsFileThreadToSuggestion(thread));
      continue;
    }
    comments.push(docsFileThreadToComment(thread));
  }
  return { comments, suggestions };
}
