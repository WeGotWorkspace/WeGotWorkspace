import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChatLinkPreview } from "@/chat-ui/src/chat-link-preview";
import { ChatStoryScope } from "@/chat-ui/stories/chat-story-scope";
import {
  CHAT_STORY_PREVIEW_DOCS,
  CHAT_STORY_PREVIEW_EXTERNAL,
  CHAT_STORY_PREVIEW_FILE,
} from "@/chat-ui/stories/chat-stories.fixtures";

const meta = {
  title: "Shared/Chat/ChatLinkPreview",
  component: ChatLinkPreview,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Internal cards wrap FilePreview / DocsFilePreview. External cards use fixture OG title, description, and site. Missing is the empty unfurl state.",
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
} satisfies Meta<typeof ChatLinkPreview>;

export default meta;
type Story = StoryObj<typeof ChatLinkPreview>;

export const InternalDocs: Story = {
  name: "Internal docs",
  args: {
    preview: CHAT_STORY_PREVIEW_DOCS,
  },
};

export const InternalFile: Story = {
  name: "Internal file",
  args: {
    preview: CHAT_STORY_PREVIEW_FILE,
  },
};

export const External: Story = {
  name: "External preview",
  args: {
    preview: CHAT_STORY_PREVIEW_EXTERNAL,
  },
};

export const Missing: Story = {
  name: "Missing preview",
  args: {
    preview: null,
  },
};
