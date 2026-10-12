import { useRef, type ReactNode } from "react";
import { ChatComposer } from "@/chat-ui/src/chat-composer";
import type {
  ChatAuthorPresenceMap,
  ChatMentionPrincipal,
  ChatSendPayload,
} from "@/chat-ui/src/chat-types";
import type { ChatMessage } from "@/meet-core/src/meet-types";
import { MeetWorkspaceThread } from "@/meet-core/src/meet-workspace-thread";

/**
 * Thread panel for the workspace rail, including inline editing of the parent.
 * The last thread stays cached so the rail keeps its contents while it closes.
 */
export function useMeetThreadSurface({
  threadPanel,
  parent,
  replies,
  currentUserId,
  mentionPrincipals,
  authorPresence,
  editingMessageId,
  onClose,
  onSendReply,
  onToggleReaction,
  onSaveEdit,
  onCancelEdit,
  onCaughtUpChange,
}: {
  /** Host override for the whole panel (stories pass their own chrome). */
  threadPanel?: ReactNode;
  parent: ChatMessage | null;
  replies: ChatMessage[];
  currentUserId: string;
  mentionPrincipals: ChatMentionPrincipal[];
  authorPresence?: ChatAuthorPresenceMap;
  editingMessageId?: string | null;
  onClose?: () => void;
  onSendReply?: (parentId: string, body: string) => void;
  onToggleReaction?: (messageId: string, emoji: string) => void;
  onSaveEdit: (messageId: string, payload: ChatSendPayload) => void;
  onCancelEdit: () => void;
  onCaughtUpChange?: (caughtUp: boolean) => void;
}): ReactNode {
  const threadCacheRef = useRef<{ parent: ChatMessage; replies: ChatMessage[] } | null>(null);
  if (parent) {
    threadCacheRef.current = { parent, replies };
  }
  const cachedThread = threadCacheRef.current;
  const parentEditing = Boolean(cachedThread && editingMessageId === cachedThread.parent.id);
  return (
    threadPanel ??
    (cachedThread ? (
      <MeetWorkspaceThread
        parent={cachedThread.parent}
        replies={cachedThread.replies}
        currentUserId={currentUserId}
        mentionPrincipals={mentionPrincipals}
        authorPresence={authorPresence}
        onClose={onClose}
        onSendReply={onSendReply}
        onToggleReaction={onToggleReaction}
        parentEditing={parentEditing}
        parentEditComposer={
          parentEditing ? (
            <ChatComposer
              principals={mentionPrincipals}
              initialContent={cachedThread.parent.body}
              onSend={(payload) => onSaveEdit(cachedThread.parent.id, payload)}
              onCancel={onCancelEdit}
              hint={null}
            />
          ) : undefined
        }
        onCaughtUpChange={onCaughtUpChange}
      />
    ) : null)
  );
}
