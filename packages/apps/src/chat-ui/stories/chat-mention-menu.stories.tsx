import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { ChatMentionMenu } from "@/chat-ui/src/chat-mention-menu";
import { ChatStoryScope } from "@/chat-ui/stories/chat-story-scope";
import { CHAT_STORY_PRINCIPALS } from "@/chat-ui/stories/chat-stories.fixtures";

const meta = {
  title: "Shared/Chat/ChatMentionMenu",
  component: ChatMentionMenu,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "`@` typeahead over principals passed as props. No network, no Meet directory import.",
      },
    },
  },
  decorators: [
    (Story) => (
      <ChatStoryScope>
        <Story />
      </ChatStoryScope>
    ),
  ],
} satisfies Meta<typeof ChatMentionMenu>;

export default meta;
type Story = StoryObj<typeof ChatMentionMenu>;

export const Default: Story = {
  name: "Mentions open",
  args: {
    principals: CHAT_STORY_PRINCIPALS,
    query: "",
    open: true,
    onSelect: fn(),
  },
};

export const Filtered: Story = {
  args: {
    principals: CHAT_STORY_PRINCIPALS,
    query: "Ada",
    open: true,
    activeIndex: 0,
    onSelect: fn(),
  },
};

export const Empty: Story = {
  args: {
    principals: CHAT_STORY_PRINCIPALS,
    query: "zzz",
    open: true,
    onSelect: fn(),
  },
};
