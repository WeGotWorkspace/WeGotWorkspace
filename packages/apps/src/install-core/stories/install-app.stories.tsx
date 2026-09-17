import type { Meta, StoryObj } from "@storybook/react-vite";
import { createInstallWorkspaceStoryArgs } from "@/lib/api/mock/install-bootstrap";
import { InstallApp } from "@/install-core/src/install-app";
import { createDefaultInstallApiSource } from "@/install-core/src/install-api-source";
import { InstallFirstRunWorkspace } from "@/install-core/src/install-first-run-workspace";

const meta: Meta<typeof InstallFirstRunWorkspace> = {
  title: "Apps/Install",
  component: InstallFirstRunWorkspace,
  parameters: {
    layout: "fullscreen",
  },
};

export default meta;
type Story = StoryObj<typeof InstallFirstRunWorkspace>;

export const Default: Story = {
  args: createInstallWorkspaceStoryArgs(),
};

/** Full app shell with injectable mock API source (offline Storybook / non-live routes). */
export const AppShell: Story = {
  render: () => <InstallApp apiSource={createDefaultInstallApiSource()} />,
};
