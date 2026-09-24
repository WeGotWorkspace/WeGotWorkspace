import type { Meta, StoryObj } from "@storybook/react-vite";
import { docsLabels } from "@/docs-core/src/docs-labels";
import { DocsSuggestionCard } from "@/text-editor-core/docs-collab/docs-suggestions";

import {
  deleteSuggestion,
  formatChangeSuggestion,
  insertSuggestion,
  insertSuggestionWithThread,
  replaceSuggestion,
  replaceSuggestionWithReactions,
  longReplaceSuggestion,
} from "./docs-suggestion-card.stories.fixtures";

const noop = () => {};

const cardHandlers = {
  labels: docsLabels,
  currentUserId: "u-alex",
  onSelect: noop,
  onAccept: noop,
  onReject: noop,
  onAddReply: noop,
  onToggleReaction: noop,
};

const meta = {
  title: "Features/Docs/TextEditor/Docs suggestions/Suggestion card",
  component: DocsSuggestionCard,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Standalone track-change suggestion card. Insert, delete, replace, and format-change fixtures mirror getDocsTrackChangeGroups output; each card shows an inline diff using the shared collab highlight primitive (green insertions, red strikethrough deletions, blue format before → after). Panel stories live under Docs suggestions/Panel.",
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
} satisfies Meta<typeof DocsSuggestionCard>;

export default meta;

type Story = StoryObj<typeof DocsSuggestionCard>;

export const Insert: Story = {
  render: () => <DocsSuggestionCard {...cardHandlers} suggestion={insertSuggestion} active />,
};

export const InsertInactive: Story = {
  name: "Insert / inactive",
  render: () => (
    <DocsSuggestionCard {...cardHandlers} suggestion={insertSuggestion} active={false} />
  ),
};

export const Delete: Story = {
  render: () => <DocsSuggestionCard {...cardHandlers} suggestion={deleteSuggestion} active />,
};

export const DeleteInactive: Story = {
  name: "Delete / inactive",
  render: () => (
    <DocsSuggestionCard {...cardHandlers} suggestion={deleteSuggestion} active={false} />
  ),
};

export const Replace: Story = {
  render: () => <DocsSuggestionCard {...cardHandlers} suggestion={replaceSuggestion} active />,
};

export const ReplaceInactive: Story = {
  name: "Replace / inactive",
  parameters: {
    docs: {
      description: {
        story:
          "Inactive cards clamp the diff to two lines via `.docs-collab-card__clamp` (see Replace / inactive long for a multi-line replace). Hover shows the full summary in the native title tooltip.",
      },
    },
  },
  render: () => (
    <DocsSuggestionCard {...cardHandlers} suggestion={replaceSuggestion} active={false} />
  ),
};

export const ReplaceInactiveLong: Story = {
  name: "Replace / inactive long",
  parameters: {
    docs: {
      description: {
        story:
          "Manual check: deletion → insertion diff should visually clamp to two lines total when inactive.",
      },
    },
  },
  render: () => (
    <DocsSuggestionCard {...cardHandlers} suggestion={longReplaceSuggestion} active={false} />
  ),
};

export const FormatChange: Story = {
  name: "Format change",
  render: () => <DocsSuggestionCard {...cardHandlers} suggestion={formatChangeSuggestion} active />,
};

export const WithRepliesAndReactions: Story = {
  name: "With replies and reactions",
  render: () => (
    <DocsSuggestionCard {...cardHandlers} suggestion={insertSuggestionWithThread} active />
  ),
};

export const WithReactionsOnly: Story = {
  name: "With reactions only",
  render: () => (
    <DocsSuggestionCard {...cardHandlers} suggestion={replaceSuggestionWithReactions} active />
  ),
};
