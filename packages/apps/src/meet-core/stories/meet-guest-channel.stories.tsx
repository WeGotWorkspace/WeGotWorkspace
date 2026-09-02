import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { MeetGuestChannel } from "@/meet-core/src/meet-guest-channel";
import {
  MeetGuestChannelStoryHarness,
  type MeetGuestChannelStoryArgs,
} from "@/meet-core/stories/meet-call-stage.stories.harness";
import { meetStoryParameters } from "@/meet-core/stories/meet-story-shared";

/**
 * Guest stripped channel: no sidebar, pre-join lobby, then chat + call stage.
 * Start/Join is a stub that admits into the in-channel layout.
 */
const meta = {
  title: "Apps/Meet/Panes/MeetGuestChannel",
  component: MeetGuestChannel,
  render: (args) => <MeetGuestChannelStoryHarness {...args} />,
  parameters: {
    layout: "fullscreen",
    ...meetStoryParameters({
      componentDescription:
        "Guest landing: ViewHeader only (hideSidebarToggle). Checking / waiting / lobby use MeetLobbyPane; in-channel is chat + MeetCallStage.",
      snippet: `<MeetGuestChannel
  channelName="Standup"
  phase="lobby"
  lobby={lobby}
  stage={stage}
  callLayout="side-by-side"
  chat={chatPlaceholder}
/>`,
    }),
  },
  argTypes: {
    phase: { control: "select", options: ["checking", "waiting", "lobby", "in-channel"] as const },
    callLayout: {
      control: "select",
      options: ["compact", "side-by-side", "fullscreen", "collapsed"] as const,
    },
  },
} satisfies Meta<MeetGuestChannelStoryArgs>;

export default meta;
type Story = StoryObj<MeetGuestChannelStoryArgs>;

export const Checking: Story = {
  name: "Checking",
  args: {
    phase: "checking",
    callLayout: "side-by-side",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "Checking meeting" })).toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: "Show sidebar" })).not.toBeInTheDocument();
  },
};

export const Waiting: Story = {
  name: "Waiting",
  args: {
    phase: "waiting",
    callLayout: "side-by-side",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "Waiting for the host" })).toBeInTheDocument();
  },
};

export const Lobby: Story = {
  name: "Lobby",
  tags: ["vitest-ci"],
  args: {
    phase: "lobby",
    callLayout: "side-by-side",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "Ready to join?" })).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Ask to join" }));
    await expect(canvas.getByText(/Standup in five/i)).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Expand call" })).toBeInTheDocument();
  },
};

export const InChannel: Story = {
  name: "In channel",
  args: {
    phase: "in-channel",
    callLayout: "side-by-side",
  },
};
