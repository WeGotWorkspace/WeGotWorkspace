import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { MeetLobbyPane } from "@/meet-core/src/meet-lobby-pane";
import {
  MeetLobbyPaneStory,
  type MeetLobbyPaneStoryArgs,
} from "@/meet-core/stories/meet-story-renders";
import {
  meetStoryParameters,
  storyBooleanControl,
  storyNumberControl,
  storyTextControl,
} from "@/meet-core/stories/meet-story-shared";

/**
 * `MeetLobbyPane` requires `MeetControllerState` (WebRTC). The render wrapper supplies a mock
 * controller via `MeetLobbyPaneHarness`; controls map to pane props and controller fields.
 */
const meta = {
  title: "Apps/Meet/Panes/MeetLobbyPane",
  component: MeetLobbyPane,
  render: (args) => <MeetLobbyPaneStory {...args} />,
  parameters: {
    layout: "fullscreen",
    ...meetStoryParameters({
      componentDescription:
        "Pre-call lobby. Requires `MeetControllerState`; stories use `MeetLobbyPaneHarness` with a mock controller.",
      snippet: `<MeetLobbyPane
  controller={controller}
  displayName="Demo User"
  inJoinFlow={false}
  hasSignedInIdentity
  invitedRoom={null}
  waitingForAdmission={false}
  knockDots={1}
  endedMessage={null}
  showMissingInviteScreen={false}
  showInviteCheckingScreen={false}
  showWaitingForHostScreen={false}
  showInviteErrorScreen={false}
  onDisplayNameChange={setDisplayName}
  onJoin={join}
  onCancelJoin={cancelJoin}
  onLeaveEndedCall={leaveEndedCall}
/>`,
    }),
  },
  argTypes: {
    displayName: storyTextControl,
    inJoinFlow: storyBooleanControl,
    hasSignedInIdentity: storyBooleanControl,
    invitedRoom: storyTextControl,
    waitingForAdmission: storyBooleanControl,
    knockDots: storyNumberControl(1, 3),
    endedMessage: storyTextControl,
    showMissingInviteScreen: storyBooleanControl,
    showInviteCheckingScreen: storyBooleanControl,
    showWaitingForHostScreen: storyBooleanControl,
    showInviteErrorScreen: storyBooleanControl,
    canStartReservedRoom: storyBooleanControl,
    videoOn: storyBooleanControl,
    error: storyTextControl,
  },
} satisfies Meta<MeetLobbyPaneStoryArgs>;

export default meta;
type Story = StoryObj<MeetLobbyPaneStoryArgs>;

const hostBase: MeetLobbyPaneStoryArgs = {
  displayName: "Demo User",
  inJoinFlow: false,
  hasSignedInIdentity: true,
  invitedRoom: "",
  waitingForAdmission: false,
  knockDots: 1,
  endedMessage: "",
  showMissingInviteScreen: false,
  showInviteCheckingScreen: false,
  showWaitingForHostScreen: false,
  showInviteErrorScreen: false,
  canStartReservedRoom: true,
  videoOn: true,
  error: "",
};

export const HostReady: Story = {
  name: "Host ready",
  tags: ["vitest-ci"],
  args: hostBase,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "Ready when you are." })).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Start meeting" })).toBeEnabled();
    await expect(canvas.getByDisplayValue("Demo User")).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Mute" })).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Stop video" })).toBeInTheDocument();
  },
};

export const HostCameraOff: Story = {
  name: "Host camera off",
  args: { ...hostBase, videoOn: false },
};

export const GuestJoin: Story = {
  name: "Guest join",
  args: {
    displayName: "Guest",
    inJoinFlow: true,
    hasSignedInIdentity: false,
    invitedRoom: "demo-room",
    waitingForAdmission: false,
    knockDots: 1,
    endedMessage: "",
    showMissingInviteScreen: false,
    showInviteCheckingScreen: false,
    showWaitingForHostScreen: false,
    showInviteErrorScreen: false,
    canStartReservedRoom: false,
    videoOn: true,
    error: "",
  },
};

export const Knocking: Story = {
  name: "Knocking",
  args: {
    displayName: "Guest",
    inJoinFlow: true,
    hasSignedInIdentity: false,
    invitedRoom: "demo-room",
    waitingForAdmission: true,
    knockDots: 2,
    endedMessage: "",
    showMissingInviteScreen: false,
    showInviteCheckingScreen: false,
    showWaitingForHostScreen: false,
    showInviteErrorScreen: false,
    canStartReservedRoom: false,
    videoOn: true,
    error: "",
  },
};

export const CallEnded: Story = {
  name: "Call ended",
  args: {
    ...hostBase,
    endedMessage: "The host ended the meeting for everyone.",
  },
};

export const MissingInvite: Story = {
  name: "Missing invite",
  args: {
    ...hostBase,
    showMissingInviteScreen: true,
  },
};

export const CheckingInvite: Story = {
  name: "Checking invite",
  args: {
    ...hostBase,
    showInviteCheckingScreen: true,
  },
};

export const WaitingForHost: Story = {
  name: "Waiting for host",
  tags: ["vitest-ci"],
  args: {
    ...hostBase,
    inJoinFlow: true,
    hasSignedInIdentity: false,
    invitedRoom: "abcd-efgh-ijkl",
    canStartReservedRoom: false,
    showWaitingForHostScreen: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "Waiting for the host" })).toBeInTheDocument();
    await expect(
      canvas.getByText("This meeting has not started yet. You can join when the host arrives."),
    ).toBeInTheDocument();
  },
};

export const InviteError: Story = {
  name: "Invite check error",
  args: {
    ...hostBase,
    showInviteErrorScreen: true,
  },
};

export const DeviceError: Story = {
  name: "Device error",
  args: {
    ...hostBase,
    error: "Microphone permission was denied.",
  },
};
