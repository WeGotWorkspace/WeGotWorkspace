import type { Meta, StoryObj } from "@storybook/react-vite";
import { createBrandingStoryMeta } from "@/branding-playground";
import {
  MeetWorkspaceStoryHarness,
  type MeetWorkspaceStoryArgs,
} from "@/meet-core/stories/meet-workspace.stories.harness";

const brandingMeta = createBrandingStoryMeta({
  appId: "meet",
  workspaceClass: "meet-workspace",
  accentToken: "workspace-accent",
  component: MeetWorkspaceStoryHarness,
  parameters: {
    routerPath: "/meet",
  },
});

const meta = {
  ...brandingMeta,
  title: "Branding/Meet",
  tags: ["vitest-ci"],
} satisfies Meta<typeof MeetWorkspaceStoryHarness>;

export default meta;
type Story = StoryObj<MeetWorkspaceStoryArgs>;

export const Default: Story = {
  render: (args) => <MeetWorkspaceStoryHarness {...args} />,
  args: {
    initialChannelId: "channel-general",
    initialCallLayout: "collapsed",
  },
};
