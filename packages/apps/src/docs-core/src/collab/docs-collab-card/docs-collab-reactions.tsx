import { useMemo } from "react";
import { Smile } from "lucide-react";
import { ReactionPicker } from "@/reaction-picker/src/reaction-picker";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";
import {
  DOCS_COMMENT_REACTION_EMOJIS,
  type DocsCommentAuthor,
  type DocsCommentReaction,
} from "@/text-editor-core/docs-collab/docs-comments-types";
import "./docs-collab-reactions.css";

export type DocsCollabReactionsProps = {
  reactions?: DocsCommentReaction[];
  currentUserId: string;
  onToggleReaction: (emoji: string) => void;
  className?: string;
  /** When false, keep existing chips visible but hide add/toggle. */
  canMutate?: boolean;
  /** Known authors used to resolve reaction userIds to display names. */
  authors?: DocsCommentAuthor[];
};

function reactionCount(reactions: DocsCommentReaction[] | undefined, emoji: string): number {
  return reactions?.find((reaction) => reaction.emoji === emoji)?.userIds.length ?? 0;
}

function userReacted(
  reactions: DocsCommentReaction[] | undefined,
  emoji: string,
  userId: string,
): boolean {
  return (
    reactions?.some((reaction) => reaction.emoji === emoji && reaction.userIds.includes(userId)) ??
    false
  );
}

function reactionUserIds(reactions: DocsCommentReaction[] | undefined, emoji: string): string[] {
  return reactions?.find((reaction) => reaction.emoji === emoji)?.userIds ?? [];
}

export function reactionAuthorNames(
  userIds: string[],
  authors: DocsCommentAuthor[] | undefined,
): string[] {
  const names = new Map((authors ?? []).map((author) => [author.id, author.name] as const));
  return userIds.map((id) => {
    const name = names.get(id)?.trim();
    return name || id;
  });
}

export function DocsCollabReactions({
  reactions,
  currentUserId,
  onToggleReaction,
  className,
  canMutate = true,
  authors,
}: DocsCollabReactionsProps) {
  const visibleReactions = useMemo(
    () =>
      reactions
        ?.filter((reaction) => reaction.userIds.length > 0)
        .map((reaction) => reaction.emoji) ?? [],
    [reactions],
  );

  const rootClassName = className ? `docs-collab-reactions ${className}` : "docs-collab-reactions";

  return (
    <div className={rootClassName} role="group" aria-label="Reactions">
      {visibleReactions.map((emoji) => {
        const count = reactionCount(reactions, emoji);
        const reacted = userReacted(reactions, emoji, currentUserId);
        const names = reactionAuthorNames(reactionUserIds(reactions, emoji), authors);
        const nameList = names.join(", ");
        const chip = (
          <button
            type="button"
            className="docs-collab-reactions__reaction"
            data-reacted={reacted ? "true" : "false"}
            aria-pressed={reacted}
            aria-label={`${emoji} ${count} ${nameList}`}
            disabled={!canMutate}
            onClick={(event) => {
              event.stopPropagation();
              if (!canMutate) return;
              onToggleReaction(emoji);
            }}
          >
            <span className="docs-collab-reactions__reaction-emoji" aria-hidden>
              {emoji}
            </span>
            <span className="docs-collab-reactions__reaction-count">{count}</span>
          </button>
        );
        return (
          <Tooltip key={emoji}>
            <TooltipTrigger asChild>
              {canMutate ? (
                chip
              ) : (
                <span className="docs-collab-reactions__reaction-wrap" tabIndex={0}>
                  {chip}
                </span>
              )}
            </TooltipTrigger>
            <TooltipContent>{nameList}</TooltipContent>
          </Tooltip>
        );
      })}
      {canMutate ? (
        <ReactionPicker
          trigger={
            <button
              type="button"
              className="docs-collab-reactions__reaction docs-collab-reactions__reaction--add"
              aria-label="Add reaction"
              onClick={(event) => event.stopPropagation()}
            >
              <Smile className="docs-collab-reactions__reaction-add-icon" aria-hidden />
            </button>
          }
          emojis={DOCS_COMMENT_REACTION_EMOJIS}
          isPicked={(emoji) => userReacted(reactions, emoji, currentUserId)}
          onPick={onToggleReaction}
        />
      ) : null}
    </div>
  );
}
