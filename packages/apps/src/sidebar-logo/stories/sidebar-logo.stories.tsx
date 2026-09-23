import type { Meta, StoryObj } from "@storybook/react-vite";
import { SidebarLogo } from "../src/sidebar-logo";
import { WorkspaceAppSwitcher } from "@/workspace-app-switcher/src/workspace-app-switcher";

const meta: Meta<typeof SidebarLogo> = {
  title: "Layout/App Logo",
  component: SidebarLogo,
  parameters: {
    layout: "fullscreen",
    routerPath: "/mail",
  },
};

export default meta;
type Story = StoryObj<typeof SidebarLogo>;

const logoArgs = {
  showAppSwitcher: true,
  onCloseMobile: () => {},
};

export const Default: Story = {
  args: {
    ...logoArgs,
    appSwitcher: <WorkspaceAppSwitcher />,
  },
};
