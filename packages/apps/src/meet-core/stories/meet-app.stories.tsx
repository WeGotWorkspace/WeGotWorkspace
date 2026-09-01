import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  MeetWorkspaceStoryHarness,
  type MeetWorkspaceStoryArgs,
} from "@/meet-core/stories/meet-workspace.stories.harness";

const meta = {
  title: "Apps/Meet",
  component: MeetWorkspaceStoryHarness,
  render: (args) => <MeetWorkspaceStoryHarness {...args} />,
  parameters: {
    layout: "fullscreen",
    routerPath: "/meet",
    docs: {
      description: {
        component:
          "Slack-like Meet workspace: channel sidebar, chat main, optional resizable call, and threads (panel idle / drawer during a call). Live `/meet` still mounts MeetCallWorkspace.",
      },
    },
  },
} satisfies Meta<typeof MeetWorkspaceStoryHarness>;

export default meta;
type Story = StoryObj<MeetWorkspaceStoryArgs>;

export const Default: Story = {
  name: "Idle channel",
  args: {
    initialChannelId: "channel-general",
    initialCallLayout: "collapsed",
  },
};

export const SharedWithMe: Story = {
  name: "Shared with me",
  args: {
    initialChannelId: "channel-design",
    initialCallLayout: "collapsed",
  },
};

export const MeetingRoom: Story = {
  name: "Meeting room",
  args: {
    initialChannelId: "meeting-standup",
    initialCallLayout: "collapsed",
  },
};

export const DirectMessage: Story = {
  name: "Direct message",
  args: {
    initialChannelId: "dm:ada.lovelace",
    initialCallLayout: "collapsed",
  },
};

export const CallSideBySide: Story = {
  name: "Call side by side",
  args: {
    initialChannelId: "channel-general",
    initialCallLayout: "side-by-side",
  },
};

export const CallFullscreen: Story = {
  name: "Call fullscreen",
  args: {
    initialChannelId: "channel-general",
    initialCallLayout: "fullscreen",
  },
};

export const ThreadOpen: Story = {
  name: "Thread",
  args: {
    initialChannelId: "channel-general",
    initialCallLayout: "collapsed",
    initialThreadId: "msg-1",
  },
};

export const ThreadOpenDuringCall: Story = {
  name: "Thread during call",
  args: {
    initialChannelId: "channel-general",
    initialCallLayout: "side-by-side",
    initialThreadId: "msg-1",
  },
};
