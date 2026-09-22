import type { Meta, StoryObj } from "@storybook/react-vite";
import { MeetShareInline } from "@/meet-core/src/meet-share";
import { STORY_MEET_CALL_LINK } from "@/meet-core/stories/meet-pane-stories.fixtures";
import {
  meetStoryParameters,
  STORY_NOOP,
  storyTextControl,
} from "@/meet-core/stories/meet-story-shared";

const meta = {
  title: "Shared/Meet/Components/MeetShareInline",
  component: MeetShareInline,
  parameters: meetStoryParameters(),
  render: (args) => (
    <div className="meet-workspace__empty-stage w-full max-w-2xl">
      <MeetShareInline {...args} />
    </div>
  ),
  argTypes: {
    link: storyTextControl,
  },
} satisfies Meta<typeof MeetShareInline>;

export default meta;
type Story = StoryObj<typeof MeetShareInline>;

export const WithLink: Story = {
  name: "With link",
  args: { link: STORY_MEET_CALL_LINK, onCopy: STORY_NOOP },
};

export const Empty: Story = {
  name: "Empty",
  args: { link: "", onCopy: STORY_NOOP },
};
