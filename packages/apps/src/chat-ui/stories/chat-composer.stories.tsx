import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChatComposer } from "@/chat-ui/src/chat-composer";
import { ChatMentionMenu } from "@/chat-ui/src/chat-mention-menu";
import type { ChatSendPayload } from "@/chat-ui/src/chat-types";
import { ChatStoryScope } from "@/chat-ui/stories/chat-story-scope";
import { CHAT_STORY_PRINCIPALS } from "@/chat-ui/stories/chat-stories.fixtures";

const meta = {
  title: "Shared/Chat/ChatComposer",
  component: ChatComposer,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Inline markdown composer (`useTextEditor` + `sheetVariant=inline`) with a compact format bar, Enter to send, and `@` mention typeahead.",
      },
    },
  },
} satisfies Meta<typeof ChatComposer>;

export default meta;
type Story = StoryObj<typeof ChatComposer>;

function ComposerLog({ last }: { last: ChatSendPayload | null }) {
  if (!last) return null;
  return <p className="chat-ui__log">Sent: {last.body}</p>;
}

export const Default: Story = {
  name: "Composing",
  render: function ComposingHarness() {
    const [last, setLast] = useState<ChatSendPayload | null>(null);
    return (
      <ChatStoryScope className="flex max-w-xl flex-col gap-3">
        <ChatComposer principals={CHAT_STORY_PRINCIPALS} onSend={setLast} />
        <ComposerLog last={last} />
      </ChatStoryScope>
    );
  },
};

export const MentionsOpen: Story = {
  name: "Mentions open",
  render: function MentionsOpenHarness() {
    const [last, setLast] = useState<ChatSendPayload | null>(null);
    return (
      <ChatStoryScope className="flex max-w-xl flex-col gap-3">
        <ChatComposer
          initialContent="Can you look at this @Ad"
          principals={CHAT_STORY_PRINCIPALS}
          onSend={setLast}
        />
        <ChatMentionMenu
          principals={CHAT_STORY_PRINCIPALS}
          query="Ad"
          open
          onSelect={() => undefined}
        />
        <ComposerLog last={last} />
      </ChatStoryScope>
    );
  },
};
