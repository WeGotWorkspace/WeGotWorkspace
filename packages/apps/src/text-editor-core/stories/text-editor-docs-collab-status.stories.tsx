import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { docsLabels } from "@/docs-core/src/docs-labels";
import { DocsCollabStatusIndicator } from "@/text-editor-core/docs-collab/docs-collab-status-indicator";
import {
  deriveDocsCollabIndicator,
  type DocsCollabIndicatorInput,
} from "@/text-editor-core/docs-collab/docs-collab-indicator";

import "@/docs-core/src/docs-workspace.css";

const quiet: DocsCollabIndicatorInput = {
  online: true,
  saving: false,
};

function StatusLine(input: DocsCollabIndicatorInput) {
  return (
    <div className="docs-workspace bg-background p-4">
      <DocsCollabStatusIndicator indicator={deriveDocsCollabIndicator(input)} />
    </div>
  );
}

const meta = {
  title: "Features/Docs/TextEditor/Docs collab/Status",
  component: DocsCollabStatusIndicator,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "The one real-time line in the Docs footer. Words come from docs labels so they can be translated. A connection that settles quickly never appears here. Who is here, and whether the document is saved, are dots rather than sentences.",
      },
    },
  },
} satisfies Meta<typeof DocsCollabStatusIndicator>;

export default meta;

type Story = StoryObj<typeof DocsCollabStatusIndicator>;

function assertStatus(input: DocsCollabIndicatorInput, label: string): NonNullable<Story["play"]> {
  return async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const status = canvas.getByRole("status");
    await expect(status).toHaveTextContent(label);
    await expect(status).toHaveAttribute(
      "data-doc-status-kind",
      deriveDocsCollabIndicator(input).kind,
    );
  };
}

export const Saving: Story = {
  tags: ["vitest-ci"],
  render: () => <StatusLine {...quiet} saving />,
  play: assertStatus({ ...quiet, saving: true }, docsLabels.statusSaving),
};

export const Offline: Story = {
  tags: ["vitest-ci"],
  render: () => <StatusLine {...quiet} online={false} />,
  play: assertStatus({ ...quiet, online: false }, docsLabels.statusOffline),
};

export const ChangesSyncWhenSaved: Story = {
  name: "Changes sync when saved",
  tags: ["vitest-ci"],
  render: () => <StatusLine {...quiet} saveOnly />,
  play: assertStatus({ ...quiet, saveOnly: true }, docsLabels.statusChangesSyncWhenSaved),
};

export const Connecting: Story = {
  tags: ["vitest-ci"],
  render: () => <StatusLine {...quiet} phase="connecting" />,
  play: assertStatus({ ...quiet, phase: "connecting" }, docsLabels.statusConnecting),
};

export const Reconnecting: Story = {
  tags: ["vitest-ci"],
  render: () => <StatusLine {...quiet} phase="reconnecting" />,
  play: assertStatus({ ...quiet, phase: "reconnecting" }, docsLabels.statusReconnecting),
};

export const Rejoining: Story = {
  tags: ["vitest-ci"],
  render: () => <StatusLine {...quiet} phase="rejoining" />,
  play: assertStatus({ ...quiet, phase: "rejoining" }, docsLabels.statusRejoining),
};
