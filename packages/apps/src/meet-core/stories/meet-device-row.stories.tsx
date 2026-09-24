import { Mic, Video } from "lucide-react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { MeetDeviceRow } from "@/meet-core/src/meet-device-row";
import {
  STORY_MEET_DEVICES,
  STORY_MEET_MICROPHONES,
} from "@/meet-core/stories/meet-pane-stories.fixtures";
import {
  meetStoryParameters,
  STORY_NOOP,
  storyTextControl,
} from "@/meet-core/stories/meet-story-shared";

type MeetDeviceRowStoryArgs = {
  kind: "camera" | "microphone";
  value: string;
};

function MeetDeviceRowStory({ kind, value }: MeetDeviceRowStoryArgs) {
  const options = kind === "camera" ? STORY_MEET_DEVICES : STORY_MEET_MICROPHONES;
  return (
    <div className="meet-workspace__form w-full max-w-md">
      <div className="meet-workspace__form-devices">
        <MeetDeviceRow
          icon={kind === "camera" ? <Video /> : <Mic />}
          label={kind === "camera" ? "Camera" : "Microphone"}
          value={value}
          onChange={STORY_NOOP}
          options={options}
        />
      </div>
    </div>
  );
}

const meta = {
  title: "Features/Meet/Components/MeetDeviceRow",
  component: MeetDeviceRow,
  render: (args) => <MeetDeviceRowStory {...args} />,
  parameters: meetStoryParameters({
    snippet: `<MeetDeviceRow
  icon={<Video />}
  label="Camera"
  value={cameraId}
  onChange={setCameraId}
  options={cameras}
/>`,
  }),
  argTypes: {
    kind: { control: "select", options: ["camera", "microphone"] },
    value: storyTextControl,
  },
} satisfies Meta<MeetDeviceRowStoryArgs>;

export default meta;
type Story = StoryObj<MeetDeviceRowStoryArgs>;

export const Camera: Story = {
  name: "Camera",
  args: { kind: "camera", value: STORY_MEET_DEVICES[0]!.id },
};

export const Microphone: Story = {
  name: "Microphone",
  args: { kind: "microphone", value: STORY_MEET_MICROPHONES[1]!.id },
};
