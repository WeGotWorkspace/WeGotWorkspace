import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import type { DocsUILabels } from "@/docs-core/src/docs-labels";
import type { DocsCommentThread } from "../docs-comments-types";
import {
  DocsCollabCardHeader,
  DocsCollabCardShell,
  DocsCollabHighlightText,
  DocsCollabMessageReply,
  DocsCollabReactions,
  useDocsCollabCardExit,
} from "../docs-collab-card";
import "./docs-comments-thread-card.css";

export type DocsCommentsThreadCardProps = {
  thread: DocsCommentThread;
  labels: DocsUILabels;
  currentUserId: string;
  active: boolean;
  /** When false, hide composer / resolve / reactions (view-only). */
  canMutate?: boolean;
  onSelect: () => void;
  onAddReply: (body: string) => void;
  onToggleReaction: (emoji: string) => void;
  onResolve: () => void;
  onCancelDraft?: () => void;
};

const COMMENT_EXIT_ANIMATION = "docs-comments-thread-card-evaporate";

export function DocsCommentsThreadCard({
  thread,
  labels,
  currentUserId,
  active,
  canMutate = true,
  onSelect,
  onAddReply,
  onToggleReaction,
  onResolve,
  onCancelDraft,
}: DocsCommentsThreadCardProps) {
  const [composerText, setComposerText] = useState("");
  const composerRef = useRef<HTMLInputElement>(null);
  const { cardRef, isExiting, runExitAnimation, handleExitAnimationEnd } = useDocsCollabCardExit({
    exitAnimationName: COMMENT_EXIT_ANIMATION,
  });
  const isDraft = thread.messages.length === 0;
  const firstMessage = thread.messages[0];
  const replies = thread.messages.slice(1);
  const trimmedComposerText = composerText.trim();
  const canPost = trimmedComposerText.length > 0;

  useEffect(() => {
    if (!active) return;
    composerRef.current?.focus();
  }, [active, thread.id]);

  useEffect(() => {
    setComposerText("");
  }, [isDraft, thread.id]);

  const submitComposer = () => {
    if (!canPost) return;
    onAddReply(trimmedComposerText);
    setComposerText("");
  };

  if (!isDraft && !firstMessage) return null;

  const authorName = firstMessage?.author.name ?? thread.createdBy.name;
  const authorCreatedAt = firstMessage?.createdAt ?? thread.createdAt;

  return (
    <DocsCollabCardShell
      cardRef={cardRef}
      className="docs-comments-thread-card"
      exitVariant="comment"
      active={active}
      isExiting={isExiting}
      onSelect={onSelect}
      onAnimationEnd={handleExitAnimationEnd}
      dataAttributes={{ "data-thread-id": thread.id }}
    >
      <DocsCollabCardHeader
        authorName={authorName}
        createdAt={authorCreatedAt}
        actions={
          isDraft || !canMutate ? null : (
            <button
              type="button"
              className="docs-comments-thread-card__resolve"
              aria-label={labels.commentsResolve}
              onClick={(event) => {
                event.stopPropagation();
                runExitAnimation(onResolve);
              }}
            >
              <Check className="docs-comments-thread-card__resolve-icon" aria-hidden />
              Resolve
            </button>
          )
        }
      />

      {thread.anchorText ? (
        <blockquote
          className="docs-comments-thread-card__quote"
          title={active ? undefined : thread.anchorText}
        >
          <span className="docs-collab-card__clamp">
            <DocsCollabHighlightText variant="comment">{thread.anchorText}</DocsCollabHighlightText>
          </span>
        </blockquote>
      ) : null}

      {firstMessage ? <p className="docs-comments-thread-card__body">{firstMessage.body}</p> : null}

      {!isDraft && canMutate ? (
        <DocsCollabReactions
          className="docs-comments-thread-card__reactions"
          reactions={thread.reactions}
          currentUserId={currentUserId}
          onToggleReaction={onToggleReaction}
        />
      ) : null}

      {replies.length > 0 ? (
        <ul className="docs-comments-thread-card__replies" aria-live="polite">
          {replies.map((message) => (
            <li key={message.id}>
              <DocsCollabMessageReply message={message} />
            </li>
          ))}
        </ul>
      ) : null}

      {active && canMutate ? (
        <div
          className="docs-comments-thread-card__composer"
          onClick={(event) => event.stopPropagation()}
        >
          <input
            ref={composerRef}
            type="text"
            className="docs-comments-thread-card__composer-input"
            value={composerText}
            placeholder={
              isDraft ? labels.commentsComposePlaceholder : labels.commentsReplyPlaceholder
            }
            aria-label={
              isDraft ? labels.commentsComposePlaceholder : labels.commentsReplyPlaceholder
            }
            onChange={(event) => setComposerText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submitComposer();
              }
              if (isDraft && event.key === "Escape") {
                event.preventDefault();
                if (onCancelDraft) runExitAnimation(onCancelDraft);
              }
            }}
          />
          <button
            type="button"
            className="docs-comments-thread-card__composer-post"
            disabled={!canPost}
            onClick={submitComposer}
          >
            {isDraft ? labels.commentsAdd : labels.commentsReplyAction}
          </button>
        </div>
      ) : null}
    </DocsCollabCardShell>
  );
}
