import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { ChatComposer } from "@/chat-ui/src/chat-composer";
import { ChatMessage, type ChatMessageAction } from "@/chat-ui/src/chat-message";
import type { ChatMessage as ChatMessageModel } from "@/lib/models/chat-types";
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
  title: "UI/Patterns/Chat/Chat Message",
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

/** Reactions, an add-reaction chip and the replies chip share one row under the body. */
export const ReactionsAndReplies: Story = {
  tags: ["vitest-ci"],
  args: {
    message: { ...CHAT_STORY_MESSAGE_DOCS, replyCount: 3 },
    currentUserId: CHAT_STORY_CURRENT_USER_ID,
    actions,
    presence: CHAT_STORY_AUTHOR_PRESENCE["ada.lovelace"],
    onOpenThread: fn(),
    onToggleReaction: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const replies = canvas.getByRole("button", { name: "3 replies" });
    // The count reads as words on the chip, not a bare number.
    await expect(replies.textContent?.trim()).toBe("3 replies");
    const footer = replies.closest(".chat-message__footer") as HTMLElement;
    await expect(footer).not.toBeNull();
    // Chips are a translucent ink wash, a step darker than the row behind them.
    await expect(getComputedStyle(replies).backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    await expect(getComputedStyle(replies).backgroundColor).toMatch(/\/ 0\.0?8\)|, 0\.0?8\)/);
    await expect(within(footer).getByRole("button", { name: /react/i })).toBeInTheDocument();
    await expect(within(footer).getByRole("button", { pressed: true })).toBeInTheDocument();
    await userEvent.click(replies);
    await expect(args.onOpenThread).toHaveBeenCalledTimes(1);

    // Hover actions float on the row, not inside the body or the chip row.
    const row = canvasElement.querySelector(".chat-message") as HTMLElement;
    const bar = row.querySelector(":scope > .chat-message__actions") as HTMLElement;
    await expect(bar).not.toBeNull();
    await expect(getComputedStyle(bar).position).toBe("absolute");
    await expect(footer.contains(bar)).toBe(false);
    // Same chrome and control size as the other floating toolbars.
    await expect(getComputedStyle(bar).paddingTop).toBe("6px");
    for (const button of bar.querySelectorAll(".button")) {
      await expect(button.classList).toContain("icon-button--size-lg");
    }
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

export const Sending: Story = {
  args: {
    message: { ...CHAT_STORY_MESSAGE_PLAIN, syncState: "pending" },
    currentUserId: CHAT_STORY_CURRENT_USER_ID,
    actions,
    presence: CHAT_STORY_AUTHOR_PRESENCE["ada.lovelace"],
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("Sending…")).toBeInTheDocument();
  },
};

export const NotSent: Story = {
  name: "Not sent",
  args: {
    message: { ...CHAT_STORY_MESSAGE_PLAIN, syncState: "failed" },
    currentUserId: CHAT_STORY_CURRENT_USER_ID,
    actions,
    presence: CHAT_STORY_AUTHOR_PRESENCE["ada.lovelace"],
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("Not sent")).toBeInTheDocument();
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
