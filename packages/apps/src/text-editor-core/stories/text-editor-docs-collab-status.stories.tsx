import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { docsLabels } from "@/docs-core/src/docs-labels";
import { DocsCollabStatusIndicator } from "@/text-editor-core/docs-collab/docs-collab-status-indicator";
import {
  deriveDocsCollabIndicator,
  formatDocsCollabLiveNames,
  type DocsCollabIndicatorInput,
} from "@/text-editor-core/docs-collab/docs-collab-indicator";

import "@/docs-core/src/docs-workspace.css";

const quiet: DocsCollabIndicatorInput = {
  online: true,
  saving: false,
  saved: false,
  liveNames: [],
};

const threeNames = ["Ada", "Bo", "Cy"] as const;
const fiveNames = ["Ada", "Bo", "Cy", "Di", "Eve"] as const;

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
          "The one real-time line in the Docs footer. Words come from docs labels so they can be translated. A connection that settles quickly never appears here.",
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

export const Live: Story = {
  name: "Live with people",
  tags: ["vitest-ci"],
  render: () => <StatusLine {...quiet} liveNames={threeNames} />,
  play: assertStatus(
    { ...quiet, liveNames: threeNames },
    docsLabels.statusLiveWith(formatDocsCollabLiveNames(threeNames)),
  ),
};

export const LiveWithMorePeople: Story = {
  name: "Live with more people",
  tags: ["vitest-ci"],
  render: () => <StatusLine {...quiet} liveNames={fiveNames} />,
  play: assertStatus(
    { ...quiet, liveNames: fiveNames },
    docsLabels.statusLiveWith(formatDocsCollabLiveNames(fiveNames)),
  ),
};

export const Saved: Story = {
  tags: ["vitest-ci"],
  render: () => <StatusLine {...quiet} saved />,
  play: assertStatus({ ...quiet, saved: true }, docsLabels.statusSaved),
};

export const Saving: Story = {
  tags: ["vitest-ci"],
  render: () => <StatusLine {...quiet} saving />,
  play: assertStatus({ ...quiet, saving: true }, docsLabels.statusSaving),
};

export const Offline: Story = {
  tags: ["vitest-ci"],
  render: () => <StatusLine {...quiet} online={false} liveNames={["Ada"]} />,
  play: assertStatus({ ...quiet, online: false, liveNames: ["Ada"] }, docsLabels.statusOffline),
};

export const ChangesSyncWhenSaved: Story = {
  name: "Changes sync when saved",
  tags: ["vitest-ci"],
  render: () => <StatusLine {...quiet} saveOnly liveNames={["Ada"]} />,
  play: assertStatus(
    { ...quiet, saveOnly: true, liveNames: ["Ada"] },
    docsLabels.statusChangesSyncWhenSaved,
  ),
};

export const Connecting: Story = {
  tags: ["vitest-ci"],
  render: () => <StatusLine {...quiet} phase="connecting" liveNames={["Ada"]} />,
  play: assertStatus(
    { ...quiet, phase: "connecting", liveNames: ["Ada"] },
    docsLabels.statusConnecting,
  ),
};

export const Reconnecting: Story = {
  tags: ["vitest-ci"],
  render: () => <StatusLine {...quiet} phase="reconnecting" saved />,
  play: assertStatus(
    { ...quiet, phase: "reconnecting", saved: true },
    docsLabels.statusReconnecting,
  ),
};

export const Rejoining: Story = {
  tags: ["vitest-ci"],
  render: () => <StatusLine {...quiet} phase="rejoining" saved />,
  play: assertStatus({ ...quiet, phase: "rejoining", saved: true }, docsLabels.statusRejoining),
};
