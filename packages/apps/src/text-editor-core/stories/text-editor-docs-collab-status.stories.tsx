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

function statusStory(name: string, input: DocsCollabIndicatorInput, label: string): Story {
  return {
    name,
    tags: ["vitest-ci"],
    render: () => <StatusLine {...input} />,
    play: async ({ canvasElement }) => {
      const canvas = within(canvasElement);
      const status = canvas.getByRole("status");
      await expect(status).toHaveTextContent(label);
      await expect(status).toHaveAttribute(
        "data-doc-status-kind",
        deriveDocsCollabIndicator(input).kind,
      );
    },
  };
}

const threeNames = ["Ada", "Bo", "Cy"] as const;
const fiveNames = ["Ada", "Bo", "Cy", "Di", "Eve"] as const;

export const Live = statusStory(
  "Live with people",
  { ...quiet, liveNames: threeNames },
  docsLabels.statusLiveWith(formatDocsCollabLiveNames(threeNames)),
);

export const LiveWithMorePeople = statusStory(
  "Live with more people",
  { ...quiet, liveNames: fiveNames },
  docsLabels.statusLiveWith(formatDocsCollabLiveNames(fiveNames)),
);

export const Saved = statusStory("Saved", { ...quiet, saved: true }, docsLabels.statusSaved);

export const Saving = statusStory("Saving", { ...quiet, saving: true }, docsLabels.statusSaving);

export const Offline = statusStory(
  "Offline",
  { ...quiet, online: false, liveNames: ["Ada"] },
  docsLabels.statusOffline,
);

export const ChangesSyncWhenSaved = statusStory(
  "Changes sync when saved",
  { ...quiet, saveOnly: true, liveNames: ["Ada"] },
  docsLabels.statusChangesSyncWhenSaved,
);

export const Connecting = statusStory(
  "Connecting",
  { ...quiet, phase: "connecting", liveNames: ["Ada"] },
  docsLabels.statusConnecting,
);

export const Reconnecting = statusStory(
  "Reconnecting",
  { ...quiet, phase: "reconnecting", saved: true },
  docsLabels.statusReconnecting,
);

export const Rejoining = statusStory(
  "Rejoining",
  { ...quiet, phase: "rejoining", saved: true },
  docsLabels.statusRejoining,
);
