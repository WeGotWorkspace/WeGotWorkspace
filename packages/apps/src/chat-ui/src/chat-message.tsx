import type { ReactNode } from "react";
import { MessageSquareReply, Pencil, Smile, Trash2 } from "lucide-react";
import { IconButton } from "@/button/src/icon-button";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { TextEditorSheet } from "@/text-editor-core/src/text-editor-sheet";
import { useTextEditor } from "@/text-editor-core/src/use-text-editor";
import {
  UserAvatar,
  avatarColorForUserId,
  type UserAvatarPresence,
} from "@/user-avatar/src/user-avatar";
import { ChatLinkPreview } from "@/chat-ui/src/chat-link-preview";
import { ChatReactionBar, CHAT_REACTION_EMOJIS } from "@/chat-ui/src/chat-reaction-bar";
import { chatUiLabels } from "@/chat-ui/src/chat-labels";
import {
  chatMessageCanOpenThread,
  omitChatNestedThreadActions,
} from "@/chat-ui/src/chat-thread-actions";
import { chatThreadReplyCountLabel } from "@/chat-ui/src/chat-thread-reply-count";
import { highlightChatMentionsMarkdown } from "@/chat-ui/src/chat-mention-utils";
import { formatChatTime } from "@/chat-ui/src/chat-message-group";
import type { ChatMessage as ChatMessageModel } from "@/chat-ui/src/chat-types";
import { cn } from "@/lib/utils";
import "@/text-editor-core/src/text-editor.css";
import "@/chat-ui/src/chat-ui.css";
import "@/chat-ui/src/chat-message.css";

export type ChatMessageActionId = "reply" | "react" | "edit" | "delete";

export type ChatMessageAction = {
  id: ChatMessageActionId;
  label?: string;
  onClick: () => void;
};

export type ChatMessageProps = {
  message: ChatMessageModel;
  currentUserId: string;
  continuation?: boolean;
  editing?: boolean;
  actions?: ChatMessageAction[];
  onToggleReaction?: (emoji: string) => void;
  /** Opens the thread when the under-body “N replies” link is used. */
  onOpenThread?: () => void;
  /** False inside ThreadPanel — one level only (main → thread). */
  allowThread?: boolean;
  presence?: UserAvatarPresence;
  /** In-place editor (typically `ChatComposer`) while `editing` is true. */
  editComposer?: ReactNode;
  className?: string;
};

function ChatMarkdownBody({
  content,
  mentions,
}: {
  content: string;
  mentions: ChatMessageModel["mentions"];
}) {
  const editor = useTextEditor({
    content: highlightChatMentionsMarkdown(content, mentions),
    format: "markdown",
    editable: false,
  });
  return <TextEditorSheet editor={editor} variant="inline" slashMenu={false} />;
}

const ACTION_ICONS: Record<ChatMessageActionId, typeof Pencil> = {
  reply: MessageSquareReply,
  react: Smile,
  edit: Pencil,
  delete: Trash2,
};

const ACTION_LABELS: Record<ChatMessageActionId, string> = {
  reply: chatUiLabels.reply,
  react: chatUiLabels.react,
  edit: chatUiLabels.edit,
  delete: chatUiLabels.delete,
};

export function ChatMessage({
  message,
  currentUserId,
  continuation = false,
  editing = false,
  actions,
  onToggleReaction,
  onOpenThread,
  allowThread = true,
  presence,
  editComposer,
  className,
}: ChatMessageProps) {
  const deleted = Boolean(message.deletedAt);
  const showHeader = !continuation;
  const showReactions = !deleted && message.reactions.length > 0 && onToggleReaction;
  const replyCount = message.replyCount ?? 0;
  const threadAllowed = allowThread && chatMessageCanOpenThread(message);
  const resolvedActions = threadAllowed ? actions : omitChatNestedThreadActions(actions);
  const openThread = threadAllowed
    ? (onOpenThread ?? resolvedActions?.find((action) => action.id === "reply")?.onClick)
    : undefined;

  return (
    <article
      className={cn(
        "chat-ui chat-message",
        continuation && "chat-message--continuation",
        className,
      )}
      data-deleted={deleted ? "true" : "false"}
      data-editing={editing ? "true" : "false"}
    >
      {showHeader ? (
        <UserAvatar
          displayName={message.authorName}
          compact
          size="sm"
          presence={presence}
          color={avatarColorForUserId(message.authorId)}
          className="chat-message__avatar"
        />
      ) : (
        <div className="chat-message__avatar-spacer" aria-hidden />
      )}
      <div className="chat-message__main">
        {showHeader ? (
          <header className="chat-message__header">
            <span className="chat-message__author">{message.authorName}</span>
            <time
              className="chat-message__time"
              dateTime={new Date(message.createdAt).toISOString()}
            >
              {formatChatTime(message.createdAt)}
            </time>
            {message.editedAt ? (
              <span className="chat-message__edited">{chatUiLabels.edited}</span>
            ) : null}
          </header>
        ) : (
          <time className="chat-message__time" dateTime={new Date(message.createdAt).toISOString()}>
            {formatChatTime(message.createdAt)}
          </time>
        )}
        {deleted ? (
          <p className="chat-message__deleted">{chatUiLabels.deleted}</p>
        ) : editing && editComposer ? (
          editComposer
        ) : (
          <div className="chat-message__body">
            <ChatMarkdownBody content={message.body} mentions={message.mentions} />
          </div>
        )}
        {!deleted && !editing && threadAllowed && replyCount > 0 ? (
          openThread ? (
            <button type="button" className="chat-message__replies" onClick={openThread}>
              {chatThreadReplyCountLabel(replyCount)}
            </button>
          ) : (
            <span className="chat-message__replies">{chatThreadReplyCountLabel(replyCount)}</span>
          )
        ) : null}
        {!deleted && !editing && message.previews.length > 0 ? (
          <div className="chat-message__previews">
            {message.previews.map((preview) => (
              <ChatLinkPreview key={preview.url} preview={preview} />
            ))}
          </div>
        ) : null}
        {showReactions && onToggleReaction ? (
          <ChatReactionBar
            className="chat-message__reactions"
            reactions={message.reactions}
            currentUserId={currentUserId}
            onToggleReaction={onToggleReaction}
          />
        ) : null}
      </div>
      {resolvedActions && resolvedActions.length > 0 && !deleted && !editing ? (
        <div className="chat-message__actions">
          {resolvedActions.map((action) => {
            const Icon = ACTION_ICONS[action.id];
            const label = action.label ?? ACTION_LABELS[action.id];
            if (action.id === "react" && onToggleReaction) {
              return (
                <Popover key={action.id}>
                  <PopoverTrigger asChild>
                    <IconButton label={label} icon={<Icon />} size="sm" variant="ghost" />
                  </PopoverTrigger>
                  <PopoverContent align="end" side="top" className="chat-reaction-bar__picker">
                    <div className="chat-reaction-bar__picker-grid">
                      {CHAT_REACTION_EMOJIS.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          className="chat-reaction-bar__picker-item"
                          onClick={() => onToggleReaction(emoji)}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              );
            }
            return (
              <IconButton
                key={action.id}
                label={label}
                icon={<Icon />}
                size="sm"
                variant="ghost"
                onClick={action.onClick}
              />
            );
          })}
        </div>
      ) : null}
    </article>
  );
}
