import type { Meta, StoryObj } from "@storybook/react-vite";
import { WeGotWorkspaceApp } from "@/wegotworkspace/src/wegotworkspace-app";
import { WeGotWorkspace } from "@/wegotworkspace/src/wegotworkspace";

const meta = {
  title: "Shared/WeGotWorkspace/Shell",
  parameters: {
    layout: "fullscreen",
    wegotworkspaceRouter: true,
    docs: {
      description: {
        component:
          "Mock-tier route matrix for the WeGotWorkspace shell catalog. Each story exercises a router entry offline. Live routes live under **Shared/Live/WeGotWorkspace**.",
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const WegotworkspaceHome: Story = {
  name: "WegotworkspaceHome",
  render: () => <WeGotWorkspace initialPath="/" />,
};

export const WegotworkspaceLoginRoute: Story = {
  name: "WegotworkspaceLoginRoute",
  render: () => <WeGotWorkspace initialPath="/login" />,
};

export const WegotworkspaceLogout: Story = {
  name: "WegotworkspaceLogout",
  render: () => <WeGotWorkspace initialPath="/logout" />,
};

export const WegotworkspaceShell: Story = {
  name: "WegotworkspaceShell",
  render: () => <WeGotWorkspace initialPath="/drive" />,
};

export const WegotworkspaceRouter: Story = {
  name: "WegotworkspaceRouter",
  render: () => <WeGotWorkspace initialPath="/notes" />,
};

export const WegotworkspaceRoutes: Story = {
  name: "WegotworkspaceRoutes",
  render: () => <WeGotWorkspace initialPath="/mail" />,
};

export const WegotworkspaceRouterShared: Story = {
  name: "WegotworkspaceRouterShared",
  render: () => <WeGotWorkspace initialPath="/settings" />,
};

export const WegotworkspaceApp: Story = {
  name: "WegotworkspaceApp",
  render: () => {
    void WeGotWorkspaceApp;
    return <WeGotWorkspace initialPath="/" />;
  },
  parameters: {
    docs: {
      description: {
        story:
          "Production entry is WeGotWorkspaceApp (browser history + live API). Offline preview uses the mock router harness.",
      },
    },
  },
};
