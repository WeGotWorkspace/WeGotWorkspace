import { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/button/src/button";
import type { DocsUILabels } from "@/docs-core/src/docs-labels";
import type { DocsCommentAuthor } from "../docs-comments-types";
import type { DocsSuggestionWithThread } from "../docs-suggestions-types";
import {
  DocsCollabCardHeader,
  DocsCollabCardShell,
  DocsCollabMessageReply,
  DocsCollabReactions,
  useDocsCollabCardExit,
} from "../docs-collab-card";
import { SuggestionDiffBody } from "./docs-suggestions-utils";
import "./docs-suggestion-card.css";

export type DocsSuggestionCardProps = {
  suggestion: DocsSuggestionWithThread;
  labels: DocsUILabels;
  currentUserId: string;
  active: boolean;
  /** When false, hide the composer and the reaction picker (chips stay visible). */
  canMutate?: boolean;
  /** When false, hide accept/reject. Defaults to `canMutate`. */
  canReview?: boolean;
  onSelect: () => void;
  onAccept: () => void;
  onReject: () => void;
  onAddReply: (body: string) => void;
  onToggleReaction: (emoji: string) => void;
};

const SUGGESTION_EXIT_ANIMATION = "docs-suggestion-card-evaporate";

export function DocsSuggestionCard({
  suggestion,
  labels,
  currentUserId,
  active,
  canMutate = true,
  canReview = canMutate,
  onSelect,
  onAccept,
  onReject,
  onAddReply,
  onToggleReaction,
}: DocsSuggestionCardProps) {
  const [composerText, setComposerText] = useState("");
  const composerRef = useRef<HTMLInputElement>(null);
  const { cardRef, isExiting, runExitAnimation, handleExitAnimationEnd } = useDocsCollabCardExit({
    exitAnimationName: SUGGESTION_EXIT_ANIMATION,
  });
  // Replies and reactions wait for the thread root: whoever writes first would
  // otherwise create it, and the card would name them as the suggestion's author.
  const canComment = canMutate && suggestion.hasThread !== false;
  const trimmedComposerText = composerText.trim();
  const canPost = trimmedComposerText.length > 0;
  const reactionAuthors: DocsCommentAuthor[] = suggestion.messages.map((message) => message.author);
  const suggestionBody = suggestion.summary || suggestion.anchorText;
  const showFallbackBody = !suggestion.parts.length && !suggestionBody && suggestion.archived;

  useEffect(() => {
    if (!active) return;
    composerRef.current?.focus();
    composerRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [active, suggestion.changeId]);

  useEffect(() => {
    setComposerText("");
  }, [suggestion.changeId]);

  const submitComposer = () => {
    if (!canPost) return;
    onAddReply(trimmedComposerText);
    setComposerText("");
  };

  return (
    <DocsCollabCardShell
      cardRef={cardRef}
      className="docs-suggestion-card"
      exitVariant="suggestion"
      active={active}
      isExiting={isExiting}
      onSelect={onSelect}
      onAnimationEnd={handleExitAnimationEnd}
      dataAttributes={{ "data-change-id": suggestion.changeId }}
    >
      <DocsCollabCardHeader
        authorName={suggestion.authorName || labels.suggestionsUnknownAuthor}
        authorColor={suggestion.authorColor}
        createdAt={suggestion.timestamp || undefined}
        actions={null}
      />

      {suggestion.parts.length > 0 ? (
        <SuggestionDiffBody
          parts={suggestion.parts}
          ariaLabel={suggestion.summary}
          title={active ? undefined : suggestion.summary}
        />
      ) : suggestionBody || showFallbackBody ? (
        <p
          className="docs-suggestion-card__diff"
          aria-label={suggestionBody || labels.suggestionsArchivedEmpty}
          title={active ? undefined : suggestionBody || labels.suggestionsArchivedEmpty}
        >
          <span className="docs-collab-card__clamp">
            {suggestionBody || labels.suggestionsArchivedEmpty}
          </span>
        </p>
      ) : null}

      {canReview ? (
        <div className="docs-suggestion-card__decision">
          <Button
            label={labels.suggestionsAcceptShort}
            aria-label={labels.suggestionsAccept}
            icon={<Check />}
            size="md"
            variant="primary"
            className="docs-suggestion-card__accept"
            onClick={(event) => {
              event.stopPropagation();
              runExitAnimation(onAccept);
            }}
          />
          <Button
            label={labels.suggestionsRejectShort}
            aria-label={labels.suggestionsReject}
            icon={<X />}
            size="md"
            variant="outline"
            className="docs-suggestion-card__reject"
            onClick={(event) => {
              event.stopPropagation();
              runExitAnimation(onReject);
            }}
          />
        </div>
      ) : null}

      {/* A commenter needs the row for its add button, also before the first reaction. */}
      {canComment || (suggestion.reactions?.length ?? 0) > 0 ? (
        <DocsCollabReactions
          className="docs-suggestion-card__reactions"
          reactions={suggestion.reactions}
          authors={reactionAuthors}
          currentUserId={currentUserId}
          canMutate={canComment}
          onToggleReaction={onToggleReaction}
        />
      ) : null}

      {suggestion.messages.length > 0 ? (
        <ul className="docs-suggestion-card__replies" aria-live="polite">
          {suggestion.messages.map((message) => (
            <li key={message.id}>
              <DocsCollabMessageReply message={message} />
            </li>
          ))}
        </ul>
      ) : null}

      {active && canComment ? (
        <div
          className="docs-suggestion-card__composer"
          onClick={(event) => event.stopPropagation()}
        >
          <input
            ref={composerRef}
            type="text"
            className="docs-suggestion-card__composer-input"
            value={composerText}
            placeholder={labels.commentsReplyPlaceholder}
            aria-label={labels.commentsReplyPlaceholder}
            onChange={(event) => setComposerText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submitComposer();
              }
            }}
          />
          <button
            type="button"
            className="docs-suggestion-card__composer-post"
            disabled={!canPost}
            onClick={submitComposer}
          >
            {labels.commentsReplyAction}
          </button>
        </div>
      ) : null}
    </DocsCollabCardShell>
  );
}
