import type { Meta, StoryObj } from "@storybook/react-vite";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { TooltipProvider } from "@/ui/tooltip";
import { CollabSessionPresence } from "@/text-editor-core/docs-collab/collab-session-presence";

const meta = {
  title: "Features/Docs/TextEditor/Docs collab/Session presence",
  component: CollabSessionPresence,
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
} satisfies Meta<typeof CollabSessionPresence>;

export default meta;
type Story = StoryObj<typeof CollabSessionPresence>;

const session = {
  awareness: new Awareness(new Y.Doc()),
  user: { name: "Alex Example", color: "#2563eb" },
};

/** The detail header of a note or task in a live room (Notes, Tasks). */
export const Header: Story = {
  args: {
    variant: "header",
    session,
    peers: [{ id: "peer-1", name: "Sam Lee" }],
  },
};

/** No live session: nothing is shown. */
export const NoSession: Story = {
  args: {
    session: null,
    peers: [],
  },
};
