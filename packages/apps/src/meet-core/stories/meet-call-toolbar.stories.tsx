import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { MeetCallToolbar } from "@/meet-core/src/meet-call-toolbar";
import { meetLabels } from "@/meet-core/src/meet-labels";
import {
  STORY_MEET_DEVICES,
  STORY_MEET_KNOCKERS,
  STORY_MEET_MICROPHONES,
  STORY_MEET_SPEAKERS,
} from "@/meet-core/stories/meet-pane-stories.fixtures";
import {
  meetStoryParameters,
  STORY_NOOP,
  storyBooleanControl,
} from "@/meet-core/stories/meet-story-shared";
import { MeetStoryScope } from "@/meet-core/stories/meet-story-scope";

type MeetCallToolbarStoryArgs = {
  micOn: boolean;
  videoOn: boolean;
  screenOn: boolean;
  canShareScreen: boolean;
  callExitLabel: string;
  callExitTitle: string;
  callExitDescription: string;
  showKnockers: boolean;
};

function MeetCallToolbarStory({
  micOn,
  videoOn,
  screenOn,
  canShareScreen,
  callExitLabel,
  callExitTitle,
  callExitDescription,
  showKnockers,
}: MeetCallToolbarStoryArgs) {
  const [camera, setCamera] = useState(STORY_MEET_DEVICES[0]!.id);
  const [microphone, setMicrophone] = useState(STORY_MEET_MICROPHONES[0]!.id);
  const [speaker, setSpeaker] = useState(STORY_MEET_SPEAKERS[0]!.id);
  return (
    <MeetStoryScope
      variant="split"
      className="meet-workspace--call-active flex h-auto min-h-0 flex-col justify-end p-6"
    >
      <MeetCallToolbar
        micOn={micOn}
        videoOn={videoOn}
        screenOn={screenOn}
        callExitLabel={callExitLabel}
        callExitTitle={callExitTitle}
        callExitDescription={callExitDescription}
        cameras={STORY_MEET_DEVICES}
        microphones={STORY_MEET_MICROPHONES}
        speakers={STORY_MEET_SPEAKERS}
        activeCamera={camera}
        activeMic={microphone}
        activeSpeaker={speaker}
        onToggleMic={STORY_NOOP}
        onToggleVideo={STORY_NOOP}
        onToggleScreenShare={STORY_NOOP}
        canShareScreen={canShareScreen}
        onCameraChange={setCamera}
        onMicrophoneChange={setMicrophone}
        onSpeakerChange={setSpeaker}
        onConfirmExit={STORY_NOOP}
        knockers={showKnockers ? STORY_MEET_KNOCKERS : []}
        onAdmitKnocker={showKnockers ? STORY_NOOP : undefined}
        onDenyKnocker={showKnockers ? STORY_NOOP : undefined}
      />
    </MeetStoryScope>
  );
}

const meta = {
  title: "Apps/Meet/Components/MeetCallToolbar",
  component: MeetCallToolbar,
  render: (args) => <MeetCallToolbarStory {...args} />,
  parameters: meetStoryParameters({
    snippet: `<MeetCallToolbar
  micOn
  videoOn
  screenOn={false}
  callExitLabel={meetLabels.endCall}
  callExitTitle={meetLabels.endCallTitle}
  callExitDescription={meetLabels.endCallDescription}
  cameras={cameras}
  microphones={microphones}
  speakers={speakers}
  activeCamera={cameraId}
  activeMic={micId}
  activeSpeaker={speakerId}
  onToggleMic={toggleMic}
  onToggleVideo={toggleVideo}
  onToggleScreenShare={toggleScreenShare}
  canShareScreen
  onCameraChange={setCameraId}
  onMicrophoneChange={setMicId}
  onSpeakerChange={setSpeakerId}
  onConfirmExit={confirmExit}
/>`,
  }),
  argTypes: {
    micOn: storyBooleanControl,
    videoOn: storyBooleanControl,
    screenOn: storyBooleanControl,
    canShareScreen: storyBooleanControl,
    callExitLabel: { table: { disable: true } },
    callExitTitle: { table: { disable: true } },
    callExitDescription: { table: { disable: true } },
    showKnockers: storyBooleanControl,
  },
} satisfies Meta<MeetCallToolbarStoryArgs>;

export default meta;
type Story = StoryObj<MeetCallToolbarStoryArgs>;

const baseArgs: MeetCallToolbarStoryArgs = {
  micOn: true,
  videoOn: true,
  screenOn: false,
  canShareScreen: true,
  callExitLabel: meetLabels.endCall,
  callExitTitle: meetLabels.endCallTitle,
  callExitDescription: meetLabels.endCallDescription,
  showKnockers: false,
};

export const Default: Story = {
  args: baseArgs,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const devices = canvas.getByRole("button", { name: meetLabels.devices });
    const leave = canvas.getByRole("button", { name: meetLabels.endCall });
    await expect(devices).toBeInTheDocument();
    await expect(leave).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: meetLabels.shareScreen })).toBeInTheDocument();
    expect(devices.compareDocumentPosition(leave) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.click(devices);
    const body = within(canvasElement.ownerDocument.body);
    await expect(body.getByText(meetLabels.microphoneLabel)).toBeInTheDocument();
    await expect(body.getByText(meetLabels.cameraLabel)).toBeInTheDocument();
    await expect(body.getByText(meetLabels.speakerLabel)).toBeInTheDocument();
  },
};

export const ScreenSharing: Story = {
  name: "Screen sharing",
  args: { ...baseArgs, screenOn: true },
};

export const ScreenShareUnavailable: Story = {
  name: "Screen share unavailable",
  tags: ["vitest-ci"],
  args: { ...baseArgs, canShareScreen: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.queryByRole("button", { name: meetLabels.shareScreen }),
    ).not.toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: meetLabels.devices })).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: meetLabels.disableAudio })).toBeInTheDocument();
  },
};

export const MediaOff: Story = {
  name: "Media off",
  args: { ...baseArgs, micOn: false, videoOn: false },
};

export const LeaveCall: Story = {
  name: "Leave call",
  args: {
    ...baseArgs,
    callExitLabel: meetLabels.leaveCall,
    callExitTitle: meetLabels.leaveCallTitle,
    callExitDescription: meetLabels.leaveCallDescription,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: meetLabels.leaveCall }));
    const body = within(canvasElement.ownerDocument.body);
    const dialog = await body.findByRole("alertdialog");
    const inDialog = within(dialog);
    await expect(dialog).toHaveClass("meet-call-dialog");
    await expect(inDialog.getByText(meetLabels.leaveCallTitle)).toBeInTheDocument();
    await expect(inDialog.getByText(meetLabels.leaveCallDescription)).toBeInTheDocument();
    await expect(inDialog.getByRole("button", { name: meetLabels.cancel })).toBeInTheDocument();
    await expect(inDialog.getByRole("button", { name: meetLabels.leaveCall })).toBeInTheDocument();
  },
};

export const EndCall: Story = {
  name: "End call for everyone",
  args: baseArgs,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: meetLabels.endCall }));
    const body = within(canvasElement.ownerDocument.body);
    const dialog = await body.findByRole("alertdialog");
    const inDialog = within(dialog);
    await expect(dialog).toHaveClass("meet-call-dialog");
    await expect(inDialog.getByText(meetLabels.endCallTitle)).toBeInTheDocument();
    await expect(inDialog.getByText(meetLabels.endCallDescription)).toBeInTheDocument();
    await expect(inDialog.getByRole("button", { name: meetLabels.cancel })).toBeInTheDocument();
  },
};

export const WaitingToJoin: Story = {
  name: "Waiting to join",
  args: { ...baseArgs, showKnockers: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: meetLabels.waitingToJoin(2) }));
    const body = within(canvasElement.ownerDocument.body);
    await expect(
      body.getByRole("button", { name: meetLabels.admitName("Alex Morgan") }),
    ).toBeInTheDocument();
  },
};
