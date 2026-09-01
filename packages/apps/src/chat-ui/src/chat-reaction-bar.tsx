import { useMemo } from "react";
import { Smile } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import type { ChatReaction } from "@/chat-ui/src/chat-types";
import { chatUiLabels } from "@/chat-ui/src/chat-labels";
import { cn } from "@/lib/utils";
import "@/chat-ui/src/chat-reaction-bar.css";

/** Same six-emoji set as Docs collab comments — copied, not shared. */
export const CHAT_REACTION_EMOJIS = ["👍", "💡", "❤️", "🎉", "👀", "✅"] as const;

export type ChatReactionBarProps = {
  reactions?: ChatReaction[];
  currentUserId: string;
  onToggleReaction: (emoji: string) => void;
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
          <button
            key={emoji}
            type="button"
            className="chat-reaction-bar__reaction"
            data-reacted={reacted ? "true" : "false"}
            aria-pressed={reacted}
            onClick={(event) => {
              event.stopPropagation();
              onToggleReaction(emoji);
            }}
          >
            <span className="chat-reaction-bar__reaction-emoji" aria-hidden>
              {emoji}
            </span>
            <span className="chat-reaction-bar__reaction-count">{count}</span>
          </button>
        );
      })}
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="chat-reaction-bar__reaction chat-reaction-bar__reaction--add"
            aria-label={chatUiLabels.react}
            onClick={(event) => event.stopPropagation()}
          >
            <Smile className="chat-reaction-bar__reaction-add-icon" aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" side="top" className="chat-reaction-bar__picker">
          <div className="chat-reaction-bar__picker-grid">
            {CHAT_REACTION_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="chat-reaction-bar__picker-item"
                aria-pressed={userReacted(reactions, emoji, currentUserId)}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleReaction(emoji);
                }}
              >
                {emoji}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
