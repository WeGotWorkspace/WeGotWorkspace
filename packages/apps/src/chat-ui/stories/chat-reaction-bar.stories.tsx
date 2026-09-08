import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChatReactionBar } from "@/chat-ui/src/chat-reaction-bar";
import type { ChatReaction } from "@/chat-ui/src/chat-types";
import { ChatStoryScope } from "@/chat-ui/stories/chat-story-scope";
import { CHAT_STORY_CURRENT_USER_ID } from "@/chat-ui/stories/chat-stories.fixtures";

const meta = {
  title: "Shared/Chat/ChatReactionBar",
  component: ChatReactionBar,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Six-emoji reaction popover copied from Docs collab comments. Do not refactor docs-collab to share this.",
      },
    },
  },
} satisfies Meta<typeof ChatReactionBar>;

export default meta;
type Story = StoryObj<typeof ChatReactionBar>;

function toggleReaction(reactions: ChatReaction[], emoji: string, userId: string): ChatReaction[] {
  const existing = reactions.find((reaction) => reaction.emoji === emoji);
  const authors = existing?.authors ?? [];
  const nextAuthors = authors.includes(userId)
    ? authors.filter((id) => id !== userId)
    : [...authors, userId];
  return [
    ...reactions.filter((reaction) => reaction.emoji !== emoji),
    ...(nextAuthors.length > 0 ? [{ emoji, authors: nextAuthors }] : []),
  ];
}

export const Default: Story = {
  render: function ReactionsHarness() {
    const [reactions, setReactions] = useState<ChatReaction[]>([
      { emoji: "👍", authors: [CHAT_STORY_CURRENT_USER_ID] },
      { emoji: "🎉", authors: ["ada.lovelace"] },
    ]);
    return (
      <ChatStoryScope>
        <ChatReactionBar
          reactions={reactions}
          currentUserId={CHAT_STORY_CURRENT_USER_ID}
          onToggleReaction={(emoji) =>
            setReactions((current) => toggleReaction(current, emoji, CHAT_STORY_CURRENT_USER_ID))
          }
        />
      </ChatStoryScope>
    );
  },
};
