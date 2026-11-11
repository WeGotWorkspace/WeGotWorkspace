import { useState, type ReactNode } from "react";
import { MessageSquare, MessageSquareReply, Pencil, Smile, Trash2 } from "lucide-react";
import { IconButton } from "@/button/src/icon-button";
import { TextEditorSheet } from "@/text-editor-core/src/text-editor-sheet";
import { useTextEditor } from "@/text-editor-core/src/use-text-editor";
import { UserAvatar } from "@/user-avatar/src/user-avatar";
import { type UserAvatarPresence } from "@/lib/models/user-presence";
import { ChatLinkPreview } from "@/chat-ui/src/chat-link-preview";
import { ChatReactionBar } from "@/chat-ui/src/chat-reaction-bar";
import { ReactionPicker } from "@/reaction-picker/src/reaction-picker";
import { chatUiLabels } from "@/chat-ui/src/chat-labels";
import {
  chatMessageCanOpenThread,
  omitChatNestedThreadActions,
} from "@/chat-ui/src/chat-thread-actions";
import { chatThreadReplyCountLabel } from "@/chat-ui/src/chat-thread-reply-count";
import { highlightChatMentionsMarkdown } from "@/chat-ui/src/chat-mention-utils";
import { formatChatTime, formatChatTimeShort } from "@/chat-ui/src/chat-message-group";
import type { ChatMessage as ChatMessageModel } from "@/lib/models/chat-types";
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
  /** Opens the thread from the replies chip under the body. */
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
  const [reactionPickerOpen, setReactionPickerOpen] = useState(false);
  const deleted = Boolean(message.deletedAt);
  const showHeader = !continuation;
  const showReactions = !deleted && message.reactions.length > 0 && onToggleReaction;
  const replyCount = message.replyCount ?? 0;
  const threadAllowed = allowThread && chatMessageCanOpenThread(message);
  const showReplies = !deleted && !editing && threadAllowed && replyCount > 0;
  const resolvedActions = threadAllowed ? actions : omitChatNestedThreadActions(actions);
  const openThread = threadAllowed
    ? (onOpenThread ?? resolvedActions?.find((action) => action.id === "reply")?.onClick)
    : undefined;
  const hoverActions =
    resolvedActions && resolvedActions.length > 0 && !deleted && !editing ? (
      <div className="chat-message__actions">
        {resolvedActions.map((action) => {
          const Icon = ACTION_ICONS[action.id];
          const label = action.label ?? ACTION_LABELS[action.id];
          if (action.id === "react" && onToggleReaction) {
            return (
              <ReactionPicker
                key={action.id}
                open={reactionPickerOpen}
                onOpenChange={setReactionPickerOpen}
                side="bottom"
                align="end"
                trigger={<IconButton label={label} icon={<Icon />} size="lg" variant="outline" />}
                isPicked={(emoji) =>
                  message.reactions?.some(
                    (reaction) =>
                      reaction.emoji === emoji && reaction.authors.includes(currentUserId),
                  ) ?? false
                }
                onPick={onToggleReaction}
              />
            );
          }
          return (
            <IconButton
              key={action.id}
              label={label}
              icon={<Icon />}
              size="lg"
              variant="outline"
              onClick={action.onClick}
            />
          );
        })}
      </div>
    ) : null;

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
          size="md"
          presence={presence}
          variant="tint"
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
            {formatChatTimeShort(message.createdAt)}
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
        {!deleted && !editing && message.previews.length > 0 ? (
          <div className="chat-message__previews">
            {message.previews.map((preview) => (
              <ChatLinkPreview key={preview.url} preview={preview} />
            ))}
          </div>
        ) : null}
        {showReactions || showReplies ? (
          <div className="chat-message__footer">
            {showReactions && onToggleReaction ? (
              <ChatReactionBar
                className="chat-message__reactions"
                reactions={message.reactions}
                currentUserId={currentUserId}
                onToggleReaction={onToggleReaction}
              />
            ) : null}
            {showReplies ? (
              <button
                type="button"
                className="chat-reaction-bar__reaction chat-message__replies"
                disabled={!openThread}
                onClick={openThread}
              >
                <MessageSquare className="chat-reaction-bar__reaction-add-icon" aria-hidden />
                <span className="chat-reaction-bar__reaction-count">
                  {chatThreadReplyCountLabel(replyCount)}
                </span>
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {hoverActions}
    </article>
  );
}
