import type { Meta, StoryObj } from "@storybook/react-vite";
import { TooltipProvider } from "@/ui/tooltip";
import { DocsCollabPresence } from "@/text-editor-core/docs-collab/docs-collab-presence";

const meta = {
  title: "Features/Docs/TextEditor/Docs collab/Presence",
  component: DocsCollabPresence,
  parameters: {
    layout: "centered",
  },
  decorators: [
    (Story) => (
      <TooltipProvider delayDuration={150}>
        <Story />
      </TooltipProvider>
    ),
  ],
} satisfies Meta<typeof DocsCollabPresence>;

export default meta;
type Story = StoryObj<typeof DocsCollabPresence>;

export const Default: Story = {
  render: () => (
    <DocsCollabPresence
      localUser={{ displayName: "Alex Example" }}
      peers={[
        { id: "peer-1", name: "Sam Lee" },
        { id: "peer-2", name: "Jordan Kim" },
      ]}
    />
  ),
};

export const Connecting: Story = {
  render: () => (
    <DocsCollabPresence
      localUser={{ displayName: "Alex Example" }}
      peers={[{ id: "peer-1", name: "Sam Lee" }]}
      connectingPeers={[{ id: "peer-2", name: "Jordan Kim" }]}
    />
  ),
};

export const Warning: Story = {
  render: () => (
    <DocsCollabPresence
      localUser={{ displayName: "Alex Example" }}
      peers={[{ id: "peer-1", name: "Sam Lee" }]}
      warningPeers={[{ id: "peer-3", name: "Casey Wu" }]}
    />
  ),
};
