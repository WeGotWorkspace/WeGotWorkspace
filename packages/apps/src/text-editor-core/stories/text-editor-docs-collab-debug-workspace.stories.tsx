import type { Meta, StoryObj } from "@storybook/react-vite";
import { DocsCollabWorkspace as DocsCollabDebugWorkspace } from "@/text-editor-core/docs-collab/docs-collab-debug-workspace";

import "@/text-editor-core/src/text-editor.css";

const meta = {
  title: "Features/Docs/TextEditor/Docs collab/Debug workspace",
  component: DocsCollabDebugWorkspace,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "RTC debug shell for local mesh collaboration. Uses the docs-collab signaling service on port 8081 (no Laravel API). Open two Storybook windows with different user names to test sync.",
      },
    },
  },
} satisfies Meta<typeof DocsCollabDebugWorkspace>;

export default meta;
type Story = StoryObj<typeof DocsCollabDebugWorkspace>;

export const Default: Story = {
  args: {
    userName: "Alex",
    autoJoin: false,
  },
};

export const AutoJoin: Story = {
  name: "Auto join mesh",
  args: {
    userName: "Sam",
    autoJoin: true,
  },
};
