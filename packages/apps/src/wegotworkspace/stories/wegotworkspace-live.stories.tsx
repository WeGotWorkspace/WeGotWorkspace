import type { Meta, StoryObj } from "@storybook/react-vite";
import { WeGotWorkspaceLive } from "@/wegotworkspace/src/wegotworkspace-live";

const defaultLiveApiBaseUrl =
  (import.meta.env.VITE_WGW_API_BASE_URL as string | undefined)?.trim() || "/api/v1";

const liveApiStoryDescription =
  "Uses the PHP dev API via Storybook proxy (`/api/v1` → `WGW_PROXY_TARGET`). " +
  "Run `pnpm setup:storybook-live-api` once, then `pnpm dev` (or `pnpm dev:api` for API only). " +
  "Restart Storybook after changing `.env.local`.";

const meta: Meta<typeof WeGotWorkspaceLive> = {
  title: "Shared/Live/WeGotWorkspace",
  component: WeGotWorkspaceLive,
  tags: ["!test", "live"],
  parameters: {
    layout: "fullscreen",
    wegotworkspaceRouter: true,
    docs: {
      description: {
        component:
          "Live-tier WeGotWorkspace shell against the PHP dev API. Mock offline shells live under **Shared/WeGotWorkspace**.",
      },
    },
  },
  argTypes: {
    apiBaseUrl: { control: "text" },
    initialPath: { control: "text" },
  },
  args: {
    apiBaseUrl: defaultLiveApiBaseUrl,
  },
};

export default meta;
type Story = StoryObj<typeof WeGotWorkspaceLive>;

export const LiveApi: Story = {
  name: "Live API",
  args: {
    initialPath: "/login",
  },
  parameters: {
    docs: {
      description: {
        story: liveApiStoryDescription,
      },
    },
  },
};

export const LiveDocs: Story = {
  name: "Live Docs",
  args: {
    initialPath: "/docs",
  },
  parameters: {
    docs: {
      description: {
        story: `${liveApiStoryDescription} Opens the Docs app route directly.`,
      },
    },
  },
};

export const LiveHome: Story = {
  name: "Live home",
  args: {
    initialPath: "/",
  },
  parameters: {
    docs: {
      description: {
        story: liveApiStoryDescription,
      },
    },
  },
};
