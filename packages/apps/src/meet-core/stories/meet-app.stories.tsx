import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { chatUiLabels } from "@/chat-ui/src/chat-labels";
import { meetLabels } from "@/meet-core/src/meet-labels";
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
          "Slack-like Meet workspace: channel sidebar, chat main, compact in-call bar under ViewHeader, expanded light stage + peer strip, and one right rail that swaps thread vs in-call chat. Call chrome is keyed to the channel that owns the session.",
      },
    },
  },
} satisfies Meta<typeof MeetWorkspaceStoryHarness>;

export default meta;
type Story = StoryObj<MeetWorkspaceStoryArgs>;

export const Default: Story = {
  name: "Live channel call",
  args: {
    initialChannelId: "channel-general",
    initialCallLayout: "collapsed",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(meetLabels.meetingStarted)).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: meetLabels.editChannel })).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: meetLabels.editChannel }).className).toContain(
      "meet-workspace__header-edit",
    );
    await expect(canvas.getByText(meetLabels.sidebarMeetings)).toBeInTheDocument();
    await expect(canvas.getByRole("img", { name: meetLabels.liveCall })).toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: meetLabels.leave })).not.toBeInTheDocument();
    await expect(
      canvas.queryByRole("button", { name: meetLabels.expandCall }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.queryByRole("button", { name: meetLabels.devices }),
    ).not.toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: meetLabels.mute })).not.toBeInTheDocument();
    const join = canvas.getByRole("button", { name: meetLabels.join });
    await expect(join).toBeInTheDocument();
    await expect(join.className).toContain("meet-call-bar__invite-button");
    await expect(join.textContent).toContain(meetLabels.join);
    await expect(canvas.queryByRole("button", { name: meetLabels.start })).not.toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: meetLabels.joined })).not.toBeInTheDocument();
    await userEvent.click(join);
    await expect(canvas.getByText(meetLabels.meetingStarted)).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: meetLabels.leave })).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: meetLabels.expandCall })).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: meetLabels.devices })).toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: meetLabels.joined })).not.toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: meetLabels.start })).not.toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: meetLabels.join })).not.toBeInTheDocument();
    await expect(canvas.queryByLabelText(meetLabels.resizeCall)).not.toBeInTheDocument();
  },
};

export const IdleChannel: Story = {
  name: "Idle channel",
  args: {
    initialChannelId: "channel-random",
    initialCallLayout: "collapsed",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByText(meetLabels.meetingStarted)).not.toBeInTheDocument();
    const start = canvas.getByRole("button", { name: meetLabels.start });
    await expect(start).toBeInTheDocument();
    await expect(start.className).toContain("meet-call-bar__invite-button");
    await expect(canvas.queryByRole("button", { name: meetLabels.leave })).not.toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: meetLabels.joined })).not.toBeInTheDocument();
    await userEvent.click(start);
    await expect(canvas.getByText(meetLabels.meetingStarted)).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: meetLabels.leave })).toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: meetLabels.joined })).not.toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: meetLabels.start })).not.toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: meetLabels.join })).not.toBeInTheDocument();
    await expect(canvas.queryByLabelText(meetLabels.resizeCall)).not.toBeInTheDocument();
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

export const CallBar: Story = {
  name: "Call bar",
  args: {
    initialChannelId: "channel-design",
    initialCallLayout: "compact",
    initialVideoOn: false,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(meetLabels.meetingStarted)).toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: meetLabels.joined })).not.toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: meetLabels.join })).not.toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: meetLabels.startVideo })).toBeInTheDocument();
    const devices = canvas.getByRole("button", { name: meetLabels.devices });
    const leave = canvas.getByRole("button", { name: meetLabels.leave });
    await expect(devices).toBeInTheDocument();
    expect(devices.compareDocumentPosition(leave) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.click(devices);
    const body = within(canvasElement.ownerDocument.body);
    await expect(body.getByText(meetLabels.microphoneLabel)).toBeInTheDocument();
    await expect(body.getByText(meetLabels.cameraLabel)).toBeInTheDocument();
    await expect(body.getByText(meetLabels.speakerLabel)).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await expect(canvas.queryByText(meetLabels.youLabel)).not.toBeInTheDocument();
  },
};

export const CallBarVideo: Story = {
  name: "Call bar video",
  args: {
    initialChannelId: "channel-design",
    initialCallLayout: "compact",
    initialVideoOn: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(meetLabels.meetingStarted)).toBeInTheDocument();
    await expect(canvas.queryByText("video on", { exact: false })).not.toBeInTheDocument();
    await expect(
      canvas.queryByRole("button", { name: meetLabels.shareScreen }),
    ).not.toBeInTheDocument();
    await expect(canvas.getByText(meetLabels.youLabel)).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: meetLabels.expandCall }));
    await expect(canvas.getByText(meetLabels.meetInChannel("#design"))).toBeInTheDocument();
    await expect(canvas.getByText(meetLabels.chatInChannel("#design"))).toBeInTheDocument();
    await expect(canvas.queryByText(meetLabels.meetingStarted)).not.toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: meetLabels.shareScreen })).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: meetLabels.devices })).toBeInTheDocument();
    await expect(canvas.queryByLabelText(meetLabels.resizeCall)).not.toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Show sidebar" })).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: meetLabels.collapseCall }));
    await expect(canvas.getByText(meetLabels.meetingStarted)).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: meetLabels.devices })).toBeInTheDocument();
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
    initialChannelId: "channel-design",
    initialCallLayout: "fullscreen",
    initialVideoOn: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(meetLabels.meetInChannel("#design"))).toBeInTheDocument();
    await expect(canvas.getByText(meetLabels.chatInChannel("#design"))).toBeInTheDocument();
    await expect(canvas.getByText(meetLabels.speaking)).toBeInTheDocument();
    await expect(canvas.queryByText(meetLabels.meetingStarted)).not.toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: meetLabels.start })).not.toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: meetLabels.collapseCall })).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: meetLabels.devices })).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Show sidebar" })).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: /Show chat|Hide chat/ })).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: meetLabels.chatClose })).toBeInTheDocument();
  },
};

export const ThreadOpen: Story = {
  name: "Thread",
  args: {
    initialChannelId: "channel-general",
    initialCallLayout: "collapsed",
    initialThreadId: "msg-1",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const reply = canvas.getByText("I'll add the agenda before noon.");
    const panel = reply.closest(".chat-thread-panel");
    await expect(panel).toBeTruthy();
    await expect(
      within(panel as HTMLElement).queryByRole("button", { name: chatUiLabels.reply }),
    ).not.toBeInTheDocument();
    await expect(
      within(panel as HTMLElement).queryByRole("button", { name: chatUiLabels.edit }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.getAllByRole("button", { name: chatUiLabels.reply }).length,
    ).toBeGreaterThan(0);
    await expect(canvas.getByLabelText(meetLabels.threadPeopleCount(3))).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: meetLabels.editChannel })).toBeInTheDocument();
    const channelActions = canvas
      .getByRole("button", { name: meetLabels.editChannel })
      .closest(".meet-workspace__header-actions");
    expect(channelActions).toBeTruthy();
    const members = within(channelActions as HTMLElement).getByLabelText(
      meetLabels.membersCount(6),
    );
    const edit = within(channelActions as HTMLElement).getByRole("button", {
      name: meetLabels.editChannel,
    });
    const kids = [...(channelActions as HTMLElement).children];
    expect(kids.indexOf(members)).toBeLessThan(kids.indexOf(edit));
  },
};

export const ThreadOpenDuringCall: Story = {
  name: "Thread during call",
  args: {
    initialChannelId: "channel-general",
    initialCallLayout: "side-by-side",
    initialThreadId: "msg-1",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    await expect(body.getByRole("button", { name: meetLabels.threadBack })).toBeInTheDocument();
    await expect(body.getByText(meetLabels.threadTitle)).toBeInTheDocument();
    await userEvent.click(body.getByRole("button", { name: meetLabels.threadBack }));
    await expect(
      body.queryByRole("button", { name: meetLabels.threadBack }),
    ).not.toBeInTheDocument();
    await expect(body.getByText(meetLabels.chatInChannel("#general"))).toBeInTheDocument();
    await expect(body.getByRole("button", { name: meetLabels.chatClose })).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: meetLabels.collapseCall })).toBeInTheDocument();
  },
};
