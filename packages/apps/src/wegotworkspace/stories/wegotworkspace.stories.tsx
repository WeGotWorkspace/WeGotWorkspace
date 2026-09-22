import type { Meta, StoryObj } from "@storybook/react-vite";
import { WeGotWorkspace } from "@/wegotworkspace/src/wegotworkspace";

const meta: Meta<typeof WeGotWorkspace> = {
  title: "Shared/WeGotWorkspace",
  component: WeGotWorkspace,
  parameters: {
    layout: "fullscreen",
    wegotworkspaceRouter: true,
    docs: {
      description: {
        component:
          "Mock shell for offline stories (`Default`, `Installer`). " +
          "For the real API, open **Shared/Live/WeGotWorkspace** (`Live API`, `Live Docs`).",
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof WeGotWorkspace>;

export const Default: Story = {
  args: {
    initialPath: "/login",
  },
};

export const Installer: Story = {
  name: "Installer",
  args: {
    initialPath: "/install",
  },
};
