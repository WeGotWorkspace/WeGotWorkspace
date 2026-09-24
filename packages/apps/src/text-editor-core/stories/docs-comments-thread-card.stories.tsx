import type { Meta, StoryObj } from "@storybook/react-vite";
import { docsLabels } from "@/docs-core/src/docs-labels";
import { DocsCommentsThreadCard } from "@/text-editor-core/docs-collab/docs-comments";

import {
  draftThread,
  sampleThread,
  threadWithReplies,
} from "./docs-comments-thread-card.stories.fixtures";

const noop = () => {};

const cardHandlers = {
  labels: docsLabels,
  currentUserId: "u-1",
  onSelect: noop,
  onAddReply: noop,
  onToggleReaction: noop,
  onResolve: noop,
};

const meta = {
  title: "Features/Docs/TextEditor/Docs comments/Thread card",
  component: DocsCommentsThreadCard,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Standalone comment thread card. Anchor text uses the shared collab highlight primitive (yellow, matching editor comment marks) without decorative quote marks. Panel-level stories live under Docs comments/Panel.",
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="max-w-sm p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DocsCommentsThreadCard>;

export default meta;

type Story = StoryObj<typeof DocsCommentsThreadCard>;

export const Active: Story = {
  render: () => <DocsCommentsThreadCard {...cardHandlers} thread={sampleThread} active />,
};

export const Inactive: Story = {
  render: () => <DocsCommentsThreadCard {...cardHandlers} thread={sampleThread} active={false} />,
};

export const Draft: Story = {
  render: () => (
    <DocsCommentsThreadCard {...cardHandlers} thread={draftThread} active onCancelDraft={noop} />
  ),
};

export const WithReplies: Story = {
  name: "With replies",
  render: () => <DocsCommentsThreadCard {...cardHandlers} thread={threadWithReplies} active />,
};

export const WithRepliesInactive: Story = {
  name: "With replies / inactive",
  render: () => (
    <DocsCommentsThreadCard {...cardHandlers} thread={threadWithReplies} active={false} />
  ),
};
