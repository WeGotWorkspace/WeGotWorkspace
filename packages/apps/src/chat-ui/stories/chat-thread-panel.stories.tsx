import type { ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, within } from "storybook/test";
import { chatUiLabels } from "@/chat-ui/src/chat-labels";
import { ChatThreadPanel } from "@/chat-ui/src/chat-thread-panel";
import type { ChatMessage, ChatSendPayload } from "@/chat-ui/src/chat-types";
import { CHAT_STORY_AUTHOR_PRESENCE } from "@/chat-ui/stories/chat-stories.fixtures";
import {
  THREAD_CURRENT_USER_ID,
  THREAD_PARENT,
  THREAD_PRINCIPALS,
  THREAD_REPLIES,
} from "@/chat-ui/stories/chat-thread-panel.stories.fixtures";

function ThreadStoryFrame({ children }: { children: ReactNode }) {
  return <div className="chat-thread-panel-story">{children}</div>;
}

function ThreadHarness({
  initialReplies,
  composerInitialContent,
}: {
  initialReplies: ChatMessage[];
  composerInitialContent?: string;
}) {
  const [replies, setReplies] = useState(initialReplies);

  const handleSend = (payload: ChatSendPayload) => {
    setReplies((current) => [
      ...current,
      {
        id: `msg-thread-reply-${current.length + 1}`,
        channelId: THREAD_PARENT.channelId,
        authorId: THREAD_CURRENT_USER_ID,
        authorName: "Demo User",
        body: payload.body,
        createdAt: Date.now(),
        reactions: [],
        mentions: payload.mentions,
        previews: [],
        parentId: THREAD_PARENT.id,
        threadId: THREAD_PARENT.id,
      },
    ]);
  };

  return (
    <ThreadStoryFrame>
      <ChatThreadPanel
        parent={THREAD_PARENT}
        replies={replies}
        currentUserId={THREAD_CURRENT_USER_ID}
        mentionPrincipals={THREAD_PRINCIPALS}
        authorPresence={CHAT_STORY_AUTHOR_PRESENCE}
        composerInitialContent={composerInitialContent}
        onClose={() => undefined}
        onSend={handleSend}
      />
    </ThreadStoryFrame>
  );
}

const meta = {
  title: "Shared/Chat/Thread",
  component: ChatThreadPanel,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Presentational thread: parent snippet, replies, and composer. Meet places this in a workspace panel or a SideDrawer.",
      },
    },
  },
} satisfies Meta<typeof ChatThreadPanel>;

export default meta;
type Story = StoryObj<typeof ChatThreadPanel>;

export const Empty: Story = {
  render: () => <ThreadHarness initialReplies={[]} />,
};

export const WithReplies: Story = {
  render: () => <ThreadHarness initialReplies={THREAD_REPLIES} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.queryByRole("button", { name: chatUiLabels.reply }),
    ).not.toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: /replies/i })).not.toBeInTheDocument();
  },
};

export const Composing: Story = {
  render: () => <ThreadHarness initialReplies={THREAD_REPLIES} composerInitialContent="On it — " />,
};
