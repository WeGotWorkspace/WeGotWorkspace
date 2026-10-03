import { memo, type ReactNode } from "react";
import { ChatThreadPanel } from "@/chat-ui/src/chat-thread-panel";
import type { ChatAuthorPresenceMap, ChatMentionPrincipal } from "@/chat-ui/src/chat-types";
import { meetLabels } from "@/meet-core/src/meet-labels";
import type { ChatMessage } from "@/meet-core/src/meet-types";

/** One Meet thread in the workspace rail: the parent, its replies, and reply actions. */
export const MeetWorkspaceThread = memo(function MeetWorkspaceThread({
  parent,
  replies,
  currentUserId,
  mentionPrincipals,
  authorPresence,
  onClose,
  onSendReply,
  onToggleReaction,
  parentEditing = false,
  parentEditComposer,
  onCaughtUpChange,
}: {
  parent: ChatMessage;
  replies: ChatMessage[];
  currentUserId: string;
  mentionPrincipals: ChatMentionPrincipal[];
  authorPresence?: ChatAuthorPresenceMap;
  onClose?: () => void;
  onSendReply?: (parentId: string, body: string) => void;
  onToggleReaction?: (messageId: string, emoji: string) => void;
  parentEditing?: boolean;
  parentEditComposer?: ReactNode;
  onCaughtUpChange?: (caughtUp: boolean) => void;
}) {
  return (
    <ChatThreadPanel
      key={parent.id}
      parent={parent}
      replies={replies}
      currentUserId={currentUserId}
      title={meetLabels.threadTitle}
      closeLabel={meetLabels.threadClose}
      mentionPrincipals={mentionPrincipals}
      authorPresence={authorPresence}
      parentEditing={parentEditing}
      parentEditComposer={parentEditComposer}
      onClose={onClose}
      onSend={onSendReply ? (payload) => onSendReply(parent.id, payload.body) : undefined}
      onToggleReaction={onToggleReaction}
      onCaughtUpChange={onCaughtUpChange}
      actionsForMessage={(message) => {
        if (message.id === parent.id) return undefined;
        return [{ id: "react", onClick: () => undefined }];
      }}
    />
  );
});
