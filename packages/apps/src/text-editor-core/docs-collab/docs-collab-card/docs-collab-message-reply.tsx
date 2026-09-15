import { UserAvatar } from "@/user-avatar/src/user-avatar";
import type { DocsCommentMessage } from "../docs-comments-types";
import { formatRelativeTimestamp } from "../docs-comments/docs-comments-utils";
import "./docs-collab-message-reply.css";

export type DocsCollabMessageReplyProps = {
  message: DocsCommentMessage;
};

export function DocsCollabMessageReply({ message }: DocsCollabMessageReplyProps) {
  return (
    <div className="docs-collab-message-reply">
      <UserAvatar
        displayName={message.author.name}
        compact
        size="md"
        className="docs-collab-message-reply__avatar"
      />
      <div className="docs-collab-message-reply__content">
        <div className="docs-collab-message-reply__header">
          <span className="docs-collab-message-reply__author">{message.author.name}</span>
          <time className="docs-collab-message-reply__time" dateTime={message.createdAt}>
            {formatRelativeTimestamp(message.createdAt)}
          </time>
        </div>
        <p className="docs-collab-message-reply__body">{message.body}</p>
      </div>
    </div>
  );
}

/** @deprecated Use DocsCollabMessageReply */
export type DocsCommentsReplyProps = DocsCollabMessageReplyProps;

/** @deprecated Use DocsCollabMessageReply */
export const DocsCommentsReply = DocsCollabMessageReply;
