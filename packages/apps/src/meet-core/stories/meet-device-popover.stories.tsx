import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { MeetDevicePopover } from "@/meet-core/src/meet-device-popover";
import {
  STORY_MEET_DEVICES,
  STORY_MEET_MICROPHONES,
  STORY_MEET_SPEAKERS,
} from "@/meet-core/stories/meet-pane-stories.fixtures";
import { meetStoryParameters, storyBooleanControl } from "@/meet-core/stories/meet-story-shared";

type MeetDevicePopoverStoryArgs = {
  defaultOpen: boolean;
};

function MeetDevicePopoverStory({ defaultOpen }: MeetDevicePopoverStoryArgs) {
  const [camera, setCamera] = useState(STORY_MEET_DEVICES[0]!.id);
  const [microphone, setMicrophone] = useState(STORY_MEET_MICROPHONES[0]!.id);
  const [speaker, setSpeaker] = useState(STORY_MEET_SPEAKERS[0]!.id);

  return (
    <div className="flex flex-1 items-end justify-center pb-16">
      <MeetDevicePopover
        cameras={STORY_MEET_DEVICES}
        microphones={STORY_MEET_MICROPHONES}
        speakers={STORY_MEET_SPEAKERS}
        camera={camera}
        microphone={microphone}
        speaker={speaker}
        onCamera={setCamera}
        onMicrophone={setMicrophone}
        onSpeaker={setSpeaker}
        defaultOpen={defaultOpen}
      />
    </div>
  );
}

const meta = {
  title: "Features/Meet/Components/MeetDevicePopover",
  component: MeetDevicePopover,
  render: (args) => <MeetDevicePopoverStory {...args} />,
  parameters: {
    layout: "fullscreen",
    ...meetStoryParameters({
      snippet: `<MeetDevicePopover
  cameras={cameras}
  microphones={microphones}
  speakers={speakers}
  camera={cameraId}
  microphone={micId}
  speaker={speakerId}
  onCamera={setCameraId}
  onMicrophone={setMicId}
  onSpeaker={setSpeakerId}
/>`,
    }),
  },
  argTypes: {
    defaultOpen: storyBooleanControl,
  },
} satisfies Meta<MeetDevicePopoverStoryArgs>;

export default meta;
type Story = StoryObj<MeetDevicePopoverStoryArgs>;

export const Closed: Story = {
  name: "Closed",
  args: { defaultOpen: false },
};

export const Open: Story = {
  name: "Open",
  args: { defaultOpen: true },
};
