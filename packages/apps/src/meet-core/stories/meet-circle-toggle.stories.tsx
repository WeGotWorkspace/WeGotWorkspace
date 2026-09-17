import {
  Mic as MicIcon,
  MicOff as MicOffIcon,
  Video as VideoIcon,
  VideoOff as VideoOffIcon,
} from "lucide-react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { MeetCircleToggle } from "@/meet-core/src/meet-circle-toggle";
import {
  meetStoryParameters,
  STORY_NOOP,
  storyBooleanControl,
} from "@/meet-core/stories/meet-story-shared";
import { MeetStoryScope } from "@/meet-core/stories/meet-story-scope";

type MeetCircleToggleStoryArgs = {
  variant: "mic-on" | "mic-off" | "video-on" | "video-off";
  large: boolean;
};

function MeetCircleToggleStory({ variant, large }: MeetCircleToggleStoryArgs) {
  const mic = variant.startsWith("mic");
  const on = variant.endsWith("on");
  const OnIcon = mic ? MicIcon : VideoIcon;
  const OffIcon = mic ? MicOffIcon : VideoOffIcon;
  const label = mic
    ? on
      ? "Disable audio"
      : "Enable audio"
    : on
      ? "Disable video"
      : "Enable video";
  return (
    <MeetCircleToggle
      on={on}
      onClick={STORY_NOOP}
      OnIcon={OnIcon}
      OffIcon={OffIcon}
      label={label}
      large={large}
    />
  );
}

const meta = {
  title: "Apps/Meet/Components/MeetCircleToggle",
  component: MeetCircleToggle,
  render: (args) => (
    <MeetStoryScope>
      <MeetCircleToggleStory {...args} />
    </MeetStoryScope>
  ),
  parameters: meetStoryParameters({
    componentDescription:
      "Circular mic/video control. Stories map a `variant` control to icon and on-state props.",
    snippet: `<MeetCircleToggle
  on
  onClick={() => {}}
  OnIcon={MicIcon}
  OffIcon={MicOffIcon}
  label="Disable audio"
  large={false}
/>`,
  }),
  argTypes: {
    variant: {
      control: "select",
      options: ["mic-on", "mic-off", "video-on", "video-off"],
    },
    large: storyBooleanControl,
  },
} satisfies Meta<MeetCircleToggleStoryArgs>;

export default meta;
type Story = StoryObj<MeetCircleToggleStoryArgs>;

export const MicOn: Story = {
  name: "Mic on",
  args: { variant: "mic-on", large: false },
};

export const MicOff: Story = {
  name: "Mic off",
  args: { variant: "mic-off", large: true },
};

export const VideoOn: Story = {
  name: "Video on",
  args: { variant: "video-on", large: true },
};

export const VideoOff: Story = {
  name: "Video off",
  args: { variant: "video-off", large: false },
};
