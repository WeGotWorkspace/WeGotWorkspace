import { useRef } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { docsLabels } from "@/docs-core/src/docs-labels";
import {
  DocsCollabCardHeader,
  DocsCollabCardShell,
  DocsCollabHighlightText,
  DocsCollabMessageReply,
  DocsCollabReactions,
  DocsCollabSidebarPanel,
  DocsCommentsReply,
} from "@/text-editor-core/docs-collab/docs-collab-card";

import { sampleThread } from "./docs-comments-thread-card.stories.fixtures";

const noop = () => {};

const meta = {
  title: "Shared/TextEditor/Docs collab/Card primitives",
  component: DocsCollabCardShell,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Shared shell, header, highlight, reply, reactions, and sidebar primitives used by comment and suggestion cards.",
      },
    },
  },
} satisfies Meta<typeof DocsCollabCardShell>;

export default meta;

type Story = StoryObj<typeof DocsCollabCardShell>;

function CardShellDemo() {
  const cardRef = useRef<HTMLElement>(null);
  return (
    <DocsCollabCardShell
      cardRef={cardRef}
      className="docs-comments-thread-card"
      exitVariant="comment"
      active
      isExiting={false}
      onSelect={noop}
      onAnimationEnd={noop}
      dataAttributes={{ "data-thread-id": "story-thread" }}
    >
      <DocsCollabCardHeader
        authorName="Alex Example"
        createdAt="2026-06-01T09:05:00.000Z"
        actions={<button type="button">Resolve</button>}
      />
      <blockquote className="docs-comments-thread-card__quote">
        <DocsCollabHighlightText variant="comment">launch checklist</DocsCollabHighlightText>
      </blockquote>
      <DocsCollabMessageReply message={sampleThread.messages[0]!} />
      <DocsCollabReactions
        reactions={sampleThread.reactions}
        currentUserId="u-2"
        onToggleReaction={noop}
      />
    </DocsCollabCardShell>
  );
}

export const Shell: Story = {
  name: "DocsCollabCardShell",
  render: () => (
    <div className="max-w-sm">
      <CardShellDemo />
    </div>
  ),
};

export const Header: Story = {
  name: "DocsCollabCardHeader",
  render: () => (
    <div className="docs-collab-card max-w-sm">
      <DocsCollabCardHeader
        authorName="Alex Example"
        createdAt="2026-06-01T09:05:00.000Z"
        actions={<button type="button">More</button>}
      />
    </div>
  ),
};

export const HighlightText: Story = {
  name: "DocsCollabHighlightText",
  render: () => (
    <p className="max-w-sm space-y-2 text-sm">
      <DocsCollabHighlightText variant="comment">Comment anchor</DocsCollabHighlightText>
      <DocsCollabHighlightText variant="insertion">Inserted text</DocsCollabHighlightText>
      <DocsCollabHighlightText variant="deletion">Deleted text</DocsCollabHighlightText>
      <DocsCollabHighlightText variant="format">Formatted text</DocsCollabHighlightText>
    </p>
  ),
};

export const MessageReply: Story = {
  name: "DocsCollabMessageReply",
  render: () => (
    <div className="max-w-sm">
      <DocsCollabMessageReply message={sampleThread.messages[0]!} />
    </div>
  ),
};

export const CommentsReplyAlias: Story = {
  name: "DocsCommentsReply",
  render: () => (
    <div className="max-w-sm">
      <DocsCommentsReply message={sampleThread.messages[0]!} />
    </div>
  ),
};

export const Reactions: Story = {
  name: "DocsCollabReactions",
  render: () => (
    <DocsCollabReactions
      reactions={sampleThread.reactions}
      currentUserId="u-2"
      onToggleReaction={noop}
    />
  ),
};

export const SidebarPanel: Story = {
  name: "DocsCollabSidebarPanel",
  render: () => (
    <div className="h-[24rem] w-full max-w-sm border">
      <DocsCollabSidebarPanel
        ariaLabel={docsLabels.commentsSidebarTitle}
        title={docsLabels.commentsSidebarTitle}
        count={1}
        countLabel={docsLabels.commentsCountOne}
        closeLabel={docsLabels.commentsCloseSidebar}
        onClose={noop}
        showCloseButton
      >
        <p className="p-4 text-sm">Panel body content</p>
      </DocsCollabSidebarPanel>
    </div>
  ),
};
