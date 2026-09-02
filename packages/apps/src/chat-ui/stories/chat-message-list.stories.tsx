import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";
import { chatUiLabels } from "@/chat-ui/src/chat-labels";
import { ChatComposer } from "@/chat-ui/src/chat-composer";
import { ChatMessageList } from "@/chat-ui/src/chat-message-list";
import type { ChatMessage } from "@/chat-ui/src/chat-types";
import { ChatStoryScope } from "@/chat-ui/stories/chat-story-scope";
import {
  attachChatStoryPreviews,
  CHAT_STORY_AUTHOR_PRESENCE,
  CHAT_STORY_CURRENT_USER_ID,
  CHAT_STORY_MESSAGES,
  CHAT_STORY_PRINCIPALS,
} from "@/chat-ui/stories/chat-stories.fixtures";

const meta = {
  title: "Shared/Chat/ChatMessageList",
  component: ChatMessageList,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Grouped message list with sticky day separators (Today / Yesterday), empty and auto-scroll states. Previews travel on each message; the harness attaches them from the fixture unfurl map.",
      },
    },
  },
} satisfies Meta<typeof ChatMessageList>;

export default meta;
type Story = StoryObj<typeof ChatMessageList>;

export const Empty: Story = {
  render: () => (
    <ChatStoryScope className="flex h-80 max-w-xl flex-col">
      <ChatMessageList messages={[]} currentUserId={CHAT_STORY_CURRENT_USER_ID} />
    </ChatStoryScope>
  ),
};

export const Populated: Story = {
  render: function PopulatedHarness() {
    const [messages, setMessages] = useState<ChatMessage[]>(CHAT_STORY_MESSAGES);
    return (
      <ChatStoryScope className="flex h-[32rem] max-w-xl flex-col gap-3">
        <ChatMessageList
          messages={messages}
          currentUserId={CHAT_STORY_CURRENT_USER_ID}
          authorPresence={CHAT_STORY_AUTHOR_PRESENCE}
          onOpenThread={fn()}
          onToggleReaction={(messageId, emoji) => {
            setMessages((current) =>
              current.map((row) => {
                if (row.id !== messageId) return row;
                const existing = row.reactions.find((reaction) => reaction.emoji === emoji);
                const authors = existing?.authors ?? [];
                const nextAuthors = authors.includes(CHAT_STORY_CURRENT_USER_ID)
                  ? authors.filter((id) => id !== CHAT_STORY_CURRENT_USER_ID)
                  : [...authors, CHAT_STORY_CURRENT_USER_ID];
                const reactions = [
                  ...row.reactions.filter((reaction) => reaction.emoji !== emoji),
                  ...(nextAuthors.length > 0 ? [{ emoji, authors: nextAuthors }] : []),
                ];
                return { ...row, reactions };
              }),
            );
          }}
          actionsForMessage={() => [
            { id: "reply", onClick: fn() },
            { id: "react", onClick: fn() },
            { id: "edit", onClick: fn() },
            { id: "delete", onClick: fn() },
          ]}
        />
        <ChatComposer
          principals={CHAT_STORY_PRINCIPALS}
          onSend={({ body, mentions }) => {
            setMessages((current) => [
              ...current,
              {
                id: `local-${current.length + 1}`,
                authorId: CHAT_STORY_CURRENT_USER_ID,
                authorName: "Demo User",
                body,
                createdAt: Date.now(),
                reactions: [],
                mentions,
                previews: attachChatStoryPreviews(body),
              },
            ]);
          }}
        />
      </ChatStoryScope>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getAllByRole("button", { name: chatUiLabels.reply }).length,
    ).toBeGreaterThan(0);
  },
};
