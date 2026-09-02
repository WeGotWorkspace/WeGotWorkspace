import type { Meta, StoryObj } from "@storybook/react-vite";
import { MeetPeerTile } from "@/meet-core/src/meet-peer-tile";
import {
  meetStoryParameters,
  STORY_NOOP,
  storyBooleanControl,
  storyTextControl,
} from "@/meet-core/stories/meet-story-shared";
import { MeetStoryScope } from "@/meet-core/stories/meet-story-scope";

const meta = {
  title: "Apps/Meet/Components/MeetPeerTile",
  component: MeetPeerTile,
  parameters: meetStoryParameters(),
  render: (args) => (
    <MeetStoryScope variant="in-call">
      <MeetPeerTile {...args} />
    </MeetStoryScope>
  ),
  argTypes: {
    name: storyTextControl,
    compact: storyBooleanControl,
  },
} satisfies Meta<typeof MeetPeerTile>;

export default meta;
type Story = StoryObj<typeof MeetPeerTile>;

export const NoVideo: Story = {
  name: "No video",
  args: {
    name: "Alex Morgan",
    stream: null,
    compact: false,
    onMuteSoon: STORY_NOOP,
  },
};

export const CompactStrip: Story = {
  name: "Compact strip",
  args: {
    name: "Jamie Lee",
    stream: null,
    compact: true,
    onMuteSoon: STORY_NOOP,
  },
};

export const Speaking: Story = {
  name: "Speaking",
  args: {
    name: "Alex Morgan",
    stream: null,
    speaking: true,
    spotlight: true,
    onMuteSoon: STORY_NOOP,
  },
};
