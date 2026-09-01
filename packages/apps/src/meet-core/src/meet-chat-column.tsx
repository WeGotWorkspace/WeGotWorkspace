import { ChatComposer } from "@/chat-ui/src/chat-composer";
import { ChatMessageList } from "@/chat-ui/src/chat-message-list";
import type {
  ChatAuthorPresenceMap,
  ChatMentionPrincipal,
  ChatSendPayload,
} from "@/chat-ui/src/chat-types";
import type { ChatMessage as MeetChatMessage } from "@/meet-core/src/meet-types";
import { cn } from "@/lib/utils";

export type MeetChatColumnProps = {
  messages: MeetChatMessage[];
  currentUserId: string;
  principals: readonly ChatMentionPrincipal[];
  placeholder?: string;
  onSend: (payload: ChatSendPayload) => void;
  onReact: (messageId: string, emoji: string) => void;
  onReply: (message: MeetChatMessage) => void;
  onDelete: (messageId: string) => void;
  authorPresence?: ChatAuthorPresenceMap;
  editingMessageId?: string | null;
  onStartEdit?: (messageId: string) => void;
  onCancelEdit?: () => void;
  onSaveEdit?: (messageId: string, payload: ChatSendPayload) => void;
  className?: string;
};

export function MeetChatColumn({
  messages,
  currentUserId,
  principals,
  placeholder,
  onSend,
  onReact,
  onReply,
  onDelete,
  authorPresence,
  editingMessageId = null,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  className,
}: MeetChatColumnProps) {
  return (
    <div className={cn("meet-workspace__chat-column", className)}>
      <ChatMessageList
        messages={messages}
        currentUserId={currentUserId}
        onToggleReaction={onReact}
        onOpenThread={(message) => {
          const meetMessage = messages.find((row) => row.id === message.id);
          if (meetMessage) onReply(meetMessage);
        }}
        authorPresence={authorPresence}
        editingMessageId={editingMessageId}
        editComposer={(message) => (
          <ChatComposer
            key={message.id}
            principals={principals}
            initialContent={message.body}
            onSend={(payload) => onSaveEdit?.(message.id, payload)}
            onCancel={onCancelEdit}
            hint={null}
          />
        )}
        actionsForMessage={(message) => {
          const canWrite = message.authorId === currentUserId;
          return [
            {
              id: "reply",
              onClick: () => {
                const meetMessage = messages.find((row) => row.id === message.id);
                if (meetMessage) onReply(meetMessage);
              },
            },
            { id: "react", onClick: () => undefined },
            ...(canWrite && onStartEdit
              ? [{ id: "edit" as const, onClick: () => onStartEdit(message.id) }]
              : []),
            ...(canWrite ? [{ id: "delete" as const, onClick: () => onDelete(message.id) }] : []),
          ];
        }}
      />
      <div className="meet-workspace__chat-composer">
        <ChatComposer principals={principals} placeholder={placeholder} onSend={onSend} />
      </div>
    </div>
  );
}
