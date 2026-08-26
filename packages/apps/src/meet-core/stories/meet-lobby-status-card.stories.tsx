import type { Meta, StoryObj } from "@storybook/react-vite";
import { MeetLobbyStatusCard } from "@/meet-core/src/meet-lobby-status-card";
import { meetLabels } from "@/meet-core/src/meet-labels";
import {
  meetStoryParameters,
  storyTextControl,
  renderInMeetScope,
} from "@/meet-core/stories/meet-story-shared";

const meta = {
  title: "Apps/Meet/Components/MeetLobbyStatusCard",
  component: MeetLobbyStatusCard,
  render: renderInMeetScope(MeetLobbyStatusCard, "root"),
  parameters: meetStoryParameters(),
  argTypes: {
    title: storyTextControl,
    body: storyTextControl,
    titleSize: { control: "select", options: ["lg", "md"] as const },
  },
} satisfies Meta<typeof MeetLobbyStatusCard>;

export default meta;
type Story = StoryObj<typeof MeetLobbyStatusCard>;

export const CallEnded: Story = {
  name: "Call ended",
  args: {
    title: meetLabels.callEndedTitle,
    body: "The host ended the meeting for everyone.",
    titleSize: "lg",
  },
};

export const MissingInvite: Story = {
  name: "Missing invite",
  args: {
    title: meetLabels.missingInviteTitle,
    body: meetLabels.missingInviteBody,
    titleSize: "lg",
  },
};

export const CheckingInvite: Story = {
  name: "Checking invite",
  args: {
    title: meetLabels.checkingInviteTitle,
    body: meetLabels.checkingInviteBody,
    titleSize: "md",
  },
};

export const WaitingForHost: Story = {
  name: "Waiting for host",
  tags: ["vitest-ci"],
  args: {
    title: meetLabels.waitingForHostTitle,
    body: meetLabels.waitingForHostBody,
    titleSize: "lg",
  },
};
