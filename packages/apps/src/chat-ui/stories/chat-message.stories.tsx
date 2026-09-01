import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { ChatComposer } from "@/chat-ui/src/chat-composer";
import { ChatMessage, type ChatMessageAction } from "@/chat-ui/src/chat-message";
import type { ChatMessage as ChatMessageModel } from "@/chat-ui/src/chat-types";
import { ChatStoryScope } from "@/chat-ui/stories/chat-story-scope";
import {
  CHAT_STORY_AUTHOR_PRESENCE,
  CHAT_STORY_CURRENT_USER_ID,
  CHAT_STORY_MESSAGE_DELETED,
  CHAT_STORY_MESSAGE_DOCS,
  CHAT_STORY_MESSAGE_EDITED,
  CHAT_STORY_MESSAGE_EXTERNAL,
  CHAT_STORY_MESSAGE_FILE,
  CHAT_STORY_MESSAGE_MISSING,
  CHAT_STORY_MESSAGE_PLAIN,
  CHAT_STORY_PRINCIPALS,
} from "@/chat-ui/stories/chat-stories.fixtures";

const actions: ChatMessageAction[] = [
  { id: "reply", onClick: fn() },
  { id: "react", onClick: fn() },
  { id: "edit", onClick: fn() },
  { id: "delete", onClick: fn() },
];

const meta = {
  title: "Shared/Chat/ChatMessage",
  component: ChatMessage,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Product-agnostic chat row: avatar, author, time, markdown body, hover actions, reactions, and optional link previews.",
      },
    },
  },
  decorators: [
    (Story) => (
      <ChatStoryScope className="max-w-xl">
        <Story />
      </ChatStoryScope>
    ),
  ],
} satisfies Meta<typeof ChatMessage>;

export default meta;
type Story = StoryObj<typeof ChatMessage>;

export const Default: Story = {
  args: {
    message: CHAT_STORY_MESSAGE_EDITED,
    currentUserId: CHAT_STORY_CURRENT_USER_ID,
    actions,
    presence: CHAT_STORY_AUTHOR_PRESENCE["demo.user"],
    onToggleReaction: fn(),
  },
};

export const WithReplies: Story = {
  args: {
    message: CHAT_STORY_MESSAGE_PLAIN,
    currentUserId: CHAT_STORY_CURRENT_USER_ID,
    actions,
    presence: CHAT_STORY_AUTHOR_PRESENCE["ada.lovelace"],
    onOpenThread: fn(),
    onToggleReaction: fn(),
  },
};

export const Reactions: Story = {
  args: {
    message: CHAT_STORY_MESSAGE_DOCS,
    currentUserId: CHAT_STORY_CURRENT_USER_ID,
    actions,
    presence: CHAT_STORY_AUTHOR_PRESENCE["ada.lovelace"],
    onToggleReaction: fn(),
  },
};

export const Editing: Story = {
  render: function EditingHarness() {
    const [message, setMessage] = useState<ChatMessageModel>(CHAT_STORY_MESSAGE_EDITED);
    const [editing, setEditing] = useState(true);
    return (
      <ChatMessage
        message={message}
        currentUserId={CHAT_STORY_CURRENT_USER_ID}
        editing={editing}
        actions={actions}
        onToggleReaction={fn()}
        editComposer={
          <ChatComposer
            initialContent={message.body}
            principals={CHAT_STORY_PRINCIPALS}
            onSend={({ body, mentions }) => {
              setMessage({
                ...message,
                body,
                mentions,
                editedAt: Date.now(),
              });
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        }
      />
    );
  },
};

export const Deleted: Story = {
  args: {
    message: CHAT_STORY_MESSAGE_DELETED,
    currentUserId: CHAT_STORY_CURRENT_USER_ID,
    actions,
    presence: CHAT_STORY_AUTHOR_PRESENCE["ada.lovelace"],
  },
};

export const InternalPreview: Story = {
  name: "Internal preview",
  args: {
    message: CHAT_STORY_MESSAGE_FILE,
    currentUserId: CHAT_STORY_CURRENT_USER_ID,
    actions,
    presence: CHAT_STORY_AUTHOR_PRESENCE["grace.hopper"],
    onToggleReaction: fn(),
  },
};

export const ExternalPreview: Story = {
  name: "External preview",
  args: {
    message: CHAT_STORY_MESSAGE_EXTERNAL,
    currentUserId: CHAT_STORY_CURRENT_USER_ID,
    actions,
    presence: CHAT_STORY_AUTHOR_PRESENCE["ada.lovelace"],
    onToggleReaction: fn(),
  },
};

export const MissingPreview: Story = {
  name: "Missing preview",
  args: {
    message: CHAT_STORY_MESSAGE_MISSING,
    currentUserId: CHAT_STORY_CURRENT_USER_ID,
    actions,
    presence: CHAT_STORY_AUTHOR_PRESENCE["grace.hopper"],
    onToggleReaction: fn(),
  },
};
