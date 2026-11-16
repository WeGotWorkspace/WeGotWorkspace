import { memo, type ReactNode } from "react";
import { ChatMessage, type ChatMessageAction } from "@/chat-ui/src/chat-message";
import type { UserAvatarPresence } from "@/lib/models/user-presence";
import type { ChatMessage as ChatMessageModel } from "@/lib/models/chat-types";
import { workspaceListRowPropsEqual } from "@/workspace-list/src/workspace-list-row-props";
import { cn } from "@/lib/utils";
import "@/chat-ui/src/chat-message-list.css";

export type ChatMessageRowProps = {
  message: ChatMessageModel;
  currentUserId: string;
  continuation: boolean;
  beforeContinuation: boolean;
  groupStart: boolean;
  editing: boolean;
  editComposer?: ReactNode;
  presence?: UserAvatarPresence;
  allowThread: boolean;
  /** Stable for the list's lifetime: they call the list's latest props. */
  actionsFor?: (message: ChatMessageModel) => ChatMessageAction[] | undefined;
  toggleReaction?: (messageId: string, emoji: string) => void;
  openThread?: (message: ChatMessageModel) => void;
};

/**
 * One message in the chat log: the row the window mounts and measures. Memoized
 * with the shared list comparison, so a new message renders only itself.
 */
export const ChatMessageRow = memo(function ChatMessageRow({
  message,
  currentUserId,
  continuation,
  beforeContinuation,
  groupStart,
  editing,
  editComposer,
  presence,
  allowThread,
  actionsFor,
  toggleReaction,
  openThread,
}: ChatMessageRowProps) {
  return (
    <div
      className={cn("chat-message-list__row", groupStart && "chat-message-list__row--group-start")}
      data-list-item-id={message.id}
    >
      <ChatMessage
        message={message}
        currentUserId={currentUserId}
        continuation={continuation}
        className={beforeContinuation ? "chat-message--before-continuation" : undefined}
        editing={editing}
        editComposer={editComposer}
        actions={actionsFor?.(message)}
        presence={presence}
        allowThread={allowThread}
        onOpenThread={openThread ? () => openThread(message) : undefined}
        onToggleReaction={toggleReaction ? (emoji) => toggleReaction(message.id, emoji) : undefined}
      />
    </div>
  );
}, workspaceListRowPropsEqual);
