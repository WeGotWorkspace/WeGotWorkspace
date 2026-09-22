import type { Meta, StoryObj } from "@storybook/react-vite";
import { MeetShareButton } from "@/meet-core/src/meet-share";
import { STORY_MEET_CALL_LINK } from "@/meet-core/stories/meet-pane-stories.fixtures";
import {
  meetStoryParameters,
  STORY_NOOP,
  storyTextControl,
  renderInMeetScope,
} from "@/meet-core/stories/meet-story-shared";

const meta = {
  title: "Features/Meet/Components/MeetShareButton",
  component: MeetShareButton,
  render: renderInMeetScope(MeetShareButton, "root"),
  parameters: meetStoryParameters(),
  argTypes: {
    link: storyTextControl,
  },
} satisfies Meta<typeof MeetShareButton>;

export default meta;
type Story = StoryObj<typeof MeetShareButton>;

export const WithLink: Story = {
  name: "With link",
  args: { link: STORY_MEET_CALL_LINK, onCopy: STORY_NOOP },
};

export const WithoutLink: Story = {
  name: "Without link",
  args: { link: "", onCopy: STORY_NOOP },
};
