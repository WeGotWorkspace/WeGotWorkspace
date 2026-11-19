import type { ChatMessage as ChatMessageModel } from "@/lib/models/chat-types";
import type { ThreadViewEntry } from "@/thread-ui/src/use-thread";

/** A thread entry in the shape chat-ui renders. The body is markdown, rendered as text. */
export function threadEntryToChatMessage(entry: ThreadViewEntry): ChatMessageModel {
  return {
    id: entry.id,
    authorId: entry.author.username,
    authorName: entry.author.displayName,
    body: entry.body ?? "",
    createdAt: Date.parse(entry.createdAt),
    editedAt: entry.editedAt ? Date.parse(entry.editedAt) : null,
    deletedAt: entry.deletedAt ? Date.parse(entry.deletedAt) : null,
    reactions: entry.reactions,
    mentions: entry.mentions,
    previews: [],
    parentId: entry.parentId,
    syncState: entry.failed ? "failed" : entry.pending ? "pending" : undefined,
  };
}
