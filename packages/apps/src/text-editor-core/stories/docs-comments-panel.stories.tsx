import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { docsLabels } from "@/docs-core/src/docs-labels";
import type { DocsCommentThread } from "@/text-editor-core/docs-collab/docs-comments-types";
import {
  DocsCommentsPanel,
  DocsCommentsSidebar,
} from "@/text-editor-core/docs-collab/docs-comments";

import "@/text-editor-core/docs-collab/docs-comments-sidebar.css";

import {
  draftThread,
  sampleThread,
  threadWithReplies,
} from "./docs-comments-thread-card.stories.fixtures";

const noop = () => {};

const panelHandlers = {
  onCloseMobile: noop,
  labels: docsLabels,
  currentUserId: "u-1",
  onSelectThread: noop,
  onAddReply: noop,
  onToggleReaction: noop,
  onResolveThread: noop,
};

const meta = {
  title: "Features/Docs/TextEditor/Docs comments/Panel",
  component: DocsCommentsPanel,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Mobile drawer and sidebar panel listing comment threads. Isolated thread card variants live under Docs comments/Thread card.",
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="h-[32rem] w-full max-w-sm border">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DocsCommentsPanel>;

export default meta;

type Story = StoryObj<typeof DocsCommentsPanel>;

export const Default: Story = {
  render: () => (
    <DocsCommentsPanel
      {...panelHandlers}
      threads={[sampleThread, threadWithReplies]}
      activeThreadId="thread-1"
    />
  ),
};

export const Empty: Story = {
  render: () => <DocsCommentsPanel {...panelHandlers} threads={[]} activeThreadId={null} />,
};

export const WithDraft: Story = {
  render: () => (
    <DocsCommentsPanel
      {...panelHandlers}
      threads={[sampleThread]}
      draftThread={draftThread}
      activeThreadId="draft-1"
      onCancelDraft={noop}
    />
  ),
};

export const SidebarAlias: Story = {
  name: "Sidebar (deprecated alias)",
  render: () => (
    <DocsCommentsSidebar {...panelHandlers} threads={[sampleThread]} activeThreadId="thread-1" />
  ),
};

function InteractivePanelDemo() {
  const [activeThreadId, setActiveThreadId] = useState<string | null>("thread-1");
  const [threads, setThreads] = useState<DocsCommentThread[]>([sampleThread, threadWithReplies]);

  return (
    <DocsCommentsPanel
      {...panelHandlers}
      threads={threads}
      activeThreadId={activeThreadId}
      onSelectThread={setActiveThreadId}
      onAddReply={(threadId, body) => {
        setThreads((current) =>
          current.map((thread) =>
            thread.id === threadId
              ? {
                  ...thread,
                  messages: [
                    ...thread.messages,
                    {
                      id: `${threadId}-reply-${thread.messages.length}`,
                      body,
                      createdAt: new Date().toISOString(),
                      author: { id: "u-1", name: "Alex Example" },
                    },
                  ],
                }
              : thread,
          ),
        );
      }}
      onResolveThread={(threadId) => {
        setThreads((current) => current.filter((thread) => thread.id !== threadId));
        setActiveThreadId(null);
      }}
    />
  );
}

export const Interactive: Story = {
  render: () => <InteractivePanelDemo />,
};
