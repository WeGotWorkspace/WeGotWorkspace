import { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { IconButton } from "@/button/src/button";
import type { DocsUILabels } from "@/docs-core/src/docs-labels";
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
  const trimmedComposerText = composerText.trim();
  const canPost = trimmedComposerText.length > 0;

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
        authorName={suggestion.authorName}
        createdAt={suggestion.timestamp}
        actions={
          <>
            <IconButton
              label={labels.suggestionsAccept}
              icon={<Check />}
              size="sm"
              variant="outline"
              severity="success"
              onClick={(event) => {
                event.stopPropagation();
                runExitAnimation(onAccept);
              }}
            />
            <IconButton
              label={labels.suggestionsReject}
              icon={<X />}
              size="sm"
              variant="outline"
              severity="danger"
              onClick={(event) => {
                event.stopPropagation();
                runExitAnimation(onReject);
              }}
            />
          </>
        }
      />

      <SuggestionDiffBody
        parts={suggestion.parts}
        ariaLabel={suggestion.summary}
        title={active ? undefined : suggestion.summary}
      />

      <DocsCollabReactions
        className="docs-suggestion-card__reactions"
        reactions={suggestion.reactions}
        currentUserId={currentUserId}
        onToggleReaction={onToggleReaction}
      />

      {suggestion.messages.length > 0 ? (
        <ul className="docs-suggestion-card__replies" aria-live="polite">
          {suggestion.messages.map((message) => (
            <li key={message.id}>
              <DocsCollabMessageReply message={message} />
            </li>
          ))}
        </ul>
      ) : null}

      {active ? (
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
