import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { MeetCallToolbar } from "@/meet-core/src/meet-call-toolbar";
import { meetLabels } from "@/meet-core/src/meet-labels";
import {
  STORY_MEET_DEVICES,
  STORY_MEET_MICROPHONES,
  STORY_MEET_SPEAKERS,
} from "@/meet-core/stories/meet-pane-stories.fixtures";
import {
  meetStoryParameters,
  STORY_NOOP,
  storyBooleanControl,
} from "@/meet-core/stories/meet-story-shared";

type MeetCallToolbarStoryArgs = {
  micOn: boolean;
  videoOn: boolean;
  screenOn: boolean;
  callExitLabel: string;
  callExitTitle: string;
  callExitDescription: string;
};

function MeetCallToolbarStory({
  micOn,
  videoOn,
  screenOn,
  callExitLabel,
  callExitTitle,
  callExitDescription,
}: MeetCallToolbarStoryArgs) {
  const [camera, setCamera] = useState(STORY_MEET_DEVICES[0]!.id);
  const [microphone, setMicrophone] = useState(STORY_MEET_MICROPHONES[0]!.id);
  const [speaker, setSpeaker] = useState(STORY_MEET_SPEAKERS[0]!.id);
  return (
    <div className="flex flex-1 flex-col justify-end pb-8">
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
        onCameraChange={setCamera}
        onMicrophoneChange={setMicrophone}
        onSpeakerChange={setSpeaker}
        onConfirmExit={STORY_NOOP}
      />
    </div>
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
    callExitLabel: { table: { disable: true } },
    callExitTitle: { table: { disable: true } },
    callExitDescription: { table: { disable: true } },
  },
} satisfies Meta<MeetCallToolbarStoryArgs>;

export default meta;
type Story = StoryObj<MeetCallToolbarStoryArgs>;

const baseArgs: MeetCallToolbarStoryArgs = {
  micOn: true,
  videoOn: true,
  screenOn: false,
  callExitLabel: meetLabels.endCall,
  callExitTitle: meetLabels.endCallTitle,
  callExitDescription: meetLabels.endCallDescription,
};

export const Default: Story = {
  args: baseArgs,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const devices = canvas.getByRole("button", { name: meetLabels.devices });
    const leave = canvas.getByRole("button", { name: meetLabels.endCall });
    await expect(devices).toBeInTheDocument();
    await expect(leave).toBeInTheDocument();
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
};
