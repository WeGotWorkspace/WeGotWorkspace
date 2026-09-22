import type { Meta, StoryObj } from "@storybook/react-vite";
import { MeetSelfPreviewPiP } from "@/meet-core/src/meet-self-preview-pip";
import {
  MeetSelfPreviewPiPStory,
  type MeetSelfPreviewPiPStoryArgs,
} from "@/meet-core/stories/meet-story-renders";
import {
  meetStoryParameters,
  storyBooleanControl,
  storyTextControl,
} from "@/meet-core/stories/meet-story-shared";

const meta = {
  title: "Shared/Meet/Components/MeetSelfPreviewPiP",
  component: MeetSelfPreviewPiP,
  render: (args) => <MeetSelfPreviewPiPStory {...args} />,
  parameters: {
    layout: "fullscreen",
    ...meetStoryParameters({
      snippet: `<MeetSelfPreviewPiP
  name="Demo User"
  stream={localStream}
  videoOn
  micOn
  onToggleMic={toggleMic}
  onToggleVideo={toggleVideo}
/>`,
    }),
  },
  argTypes: {
    name: storyTextControl,
    videoOn: storyBooleanControl,
    micOn: storyBooleanControl,
  },
} satisfies Meta<MeetSelfPreviewPiPStoryArgs>;

export default meta;
type Story = StoryObj<MeetSelfPreviewPiPStoryArgs>;

export const VideoOn: Story = {
  name: "Video on",
  args: { name: "Demo User", videoOn: true, micOn: true },
};

export const VideoOff: Story = {
  name: "Video off",
  args: { name: "Demo User", videoOn: false, micOn: false },
};

export const MicMuted: Story = {
  name: "Mic muted",
  args: { name: "Alex Morgan", videoOn: true, micOn: false },
};
