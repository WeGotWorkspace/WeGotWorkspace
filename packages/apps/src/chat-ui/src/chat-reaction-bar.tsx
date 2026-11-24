import { useMemo } from "react";
import { REACTION_EMOJIS } from "@/reaction-picker/src/reaction-emojis";
import { ReactionAddPicker, ReactionChip } from "@/reaction-picker/src/reaction-chip";
import type { ChatReaction } from "@/lib/models/chat-types";
import { chatUiLabels } from "@/chat-ui/src/chat-labels";
import { cn } from "@/lib/utils";
import "@/chat-ui/src/chat-reaction-bar.css";

/** The suite reaction set (shared with Docs comments). */
export const CHAT_REACTION_EMOJIS = REACTION_EMOJIS;

export type ChatReactionBarProps = {
  reactions?: ChatReaction[];
  currentUserId: string;
  onToggleReaction: (emoji: string) => void;
  /** Shows the counts only: no toggling and no picker (a reader without write access). */
  readOnly?: boolean;
  className?: string;
};

function reactionCount(reactions: ChatReaction[] | undefined, emoji: string): number {
  return reactions?.find((reaction) => reaction.emoji === emoji)?.authors.length ?? 0;
}

function userReacted(
  reactions: ChatReaction[] | undefined,
  emoji: string,
  userId: string,
): boolean {
  return (
    reactions?.some((reaction) => reaction.emoji === emoji && reaction.authors.includes(userId)) ??
    false
  );
}

export function ChatReactionBar({
  reactions,
  currentUserId,
  onToggleReaction,
  readOnly = false,
  className,
}: ChatReactionBarProps) {
  const visibleReactions = useMemo(
    () =>
      reactions
        ?.filter((reaction) => reaction.authors.length > 0)
        .map((reaction) => reaction.emoji) ?? [],
    [reactions],
  );

  return (
    <div className={cn("chat-reaction-bar", className)} role="group" aria-label="Reactions">
      {visibleReactions.map((emoji) => {
        const count = reactionCount(reactions, emoji);
        const reacted = userReacted(reactions, emoji, currentUserId);
        return (
          <ReactionChip
            key={emoji}
            emoji={emoji}
            count={count}
            reacted={reacted}
            disabled={readOnly}
            onClick={(event) => {
              event.stopPropagation();
              onToggleReaction(emoji);
            }}
          />
        );
      })}
      {readOnly ? null : (
        <ReactionAddPicker
          label={chatUiLabels.react}
          isPicked={(emoji) => userReacted(reactions, emoji, currentUserId)}
          onPick={onToggleReaction}
        />
      )}
    </div>
  );
}
