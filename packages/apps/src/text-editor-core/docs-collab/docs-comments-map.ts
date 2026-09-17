import type * as Y from "yjs";
import { createChatMessageUlid } from "@/lib/offline/meet-chat/chat-ulid";
import { parseDocsCommentThread } from "./docs-comments/docs-comments-schema";
import { DOCS_COMMENTS_MAP_KEY, type DocsCommentThread } from "./docs-comments-types";

/** Client ULID — same idempotency key the live threads API uses for VJOURNAL UID. */
export function createDocsCommentId(): string {
  return createChatMessageUlid();
}

export { parseDocsCommentThread } from "./docs-comments/docs-comments-schema";

export function readDocsCommentThreadsFromMap(map: Y.Map<unknown>): DocsCommentThread[] {
  const threads: DocsCommentThread[] = [];
  map.forEach((value, key) => {
    const thread = parseDocsCommentThread(value, key);
    if (thread) threads.push(thread);
  });
  return threads.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function getDocsCommentsMap(ydoc: Y.Doc): Y.Map<unknown> {
  return ydoc.getMap(DOCS_COMMENTS_MAP_KEY);
}

export function isPersistedOpenThread(thread: DocsCommentThread): boolean {
  return !thread.resolved && thread.messages.length > 0;
}
