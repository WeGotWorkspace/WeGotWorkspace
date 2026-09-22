import { useMemo } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { createMemoryHistory } from "@tanstack/react-router";
import { WgwApiRuntimeProvider } from "@/lib/api/wgw/wgw-api-runtime-provider";
import { WeGotWorkspaceLive } from "@/wegotworkspace/src/wegotworkspace-live";
import { WeGotWorkspaceRouter } from "@/wegotworkspace/src/wegotworkspace-router";
import { withWeGotWorkspaceAuth } from "@/wegotworkspace/src/wegotworkspace-require-auth";

const meta = {
  title: "Features/Workspace/Live/Shell",
  tags: ["!test", "live"],
  parameters: {
    layout: "fullscreen",
    wegotworkspaceRouter: true,
    docs: {
      description: {
        component:
          "Live-tier router harnesses for WeGotWorkspace. Requires the PHP dev API (`pnpm setup:storybook-live-api`). Mock shells: **Features/Workspace/Shell**.",
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj;

function LiveRouterHarness({ initialPath }: { initialPath: string }) {
  const history = useMemo(
    () => createMemoryHistory({ initialEntries: [initialPath] }),
    [initialPath],
  );
  return (
    <WgwApiRuntimeProvider apiBaseUrl="/api/v1">
      <WeGotWorkspaceRouter mode="live" history={history} />
    </WgwApiRuntimeProvider>
  );
}

export const WegotworkspaceLive: Story = {
  name: "WegotworkspaceLive",
  render: () => <WeGotWorkspaceLive initialPath="/login" apiBaseUrl="/api/v1" />,
};

export const WegotworkspaceLiveHome: Story = {
  name: "WegotworkspaceLiveHome",
  render: () => <LiveRouterHarness initialPath="/" />,
};

export const WegotworkspaceRequireAuth: Story = {
  name: "WegotworkspaceRequireAuth",
  render: () => {
    void withWeGotWorkspaceAuth;
    return <LiveRouterHarness initialPath="/drive" />;
  },
};
