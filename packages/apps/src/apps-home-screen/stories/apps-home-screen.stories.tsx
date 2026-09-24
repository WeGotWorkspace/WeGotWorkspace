import type { Meta, StoryObj } from "@storybook/react-vite";
import { AppsHomeScreen } from "../src/apps-home-screen";
import { WORKSPACE_APP_ACCENT } from "@/lib/workspace-app-icons";

const meta: Meta<typeof AppsHomeScreen> = {
  title: "Features/Workspace/Apps Home Screen",
  component: AppsHomeScreen,
  parameters: {
    layout: "fullscreen",
    routerPath: "/",
  },
};

export default meta;
type Story = StoryObj<typeof AppsHomeScreen>;

export const Default: Story = {
  args: {
    showUserMenu: true,
    userDisplayName: "Elias Linden",
    onLogout: () => {},
    apps: [
      {
        id: "drive",
        label: "Drive",
        appId: "drive",
        accent: WORKSPACE_APP_ACCENT.drive,
        fg: "#ffffff",
      },
      {
        id: "mail",
        label: "Mail",
        appId: "mail",
        accent: WORKSPACE_APP_ACCENT.mail,
      },
      {
        id: "meet",
        label: "Meet",
        appId: "meet",
        accent: WORKSPACE_APP_ACCENT.meet,
        fg: "#ffffff",
      },
      {
        id: "notes",
        label: "Notes",
        appId: "notes",
        accent: WORKSPACE_APP_ACCENT.notes,
      },
      {
        id: "admin",
        label: "Admin",
        appId: "admin",
        accent: WORKSPACE_APP_ACCENT.admin,
        fg: "#ffffff",
      },
      {
        id: "settings",
        label: "Settings",
        appId: "settings",
        accent: WORKSPACE_APP_ACCENT.settings,
      },
    ],
  },
};
