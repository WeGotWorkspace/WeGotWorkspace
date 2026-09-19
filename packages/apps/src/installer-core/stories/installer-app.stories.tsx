import type { Meta, StoryObj } from "@storybook/react-vite";
import { createInstallerWorkspaceStoryArgs } from "@/lib/api/mock/installer-bootstrap";
import { InstallerApp } from "@/installer-core/src/installer-app";
import { createDefaultInstallerApiSource } from "@/installer-core/src/installer-api-source";
import { InstallerWorkspace } from "@/installer-core/src/installer-workspace";

const meta: Meta<typeof InstallerWorkspace> = {
  title: "Apps/Installer/App",
  component: InstallerWorkspace,
  parameters: {
    layout: "fullscreen",
  },
};

export default meta;
type Story = StoryObj<typeof InstallerWorkspace>;

export const Default: Story = {
  args: createInstallerWorkspaceStoryArgs(),
};

/** Full app shell with injectable mock API source (offline Storybook / non-live routes). */
export const AppShell: Story = {
  render: () => <InstallerApp apiSource={createDefaultInstallerApiSource()} />,
};
