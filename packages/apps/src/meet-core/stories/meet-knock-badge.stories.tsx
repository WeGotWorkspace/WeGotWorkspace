import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { MeetKnockBadge } from "@/meet-core/src/meet-knock-badge";
import { meetLabels } from "@/meet-core/src/meet-labels";
import { STORY_MEET_KNOCKERS } from "@/meet-core/stories/meet-pane-stories.fixtures";
import { meetStoryParameters, STORY_NOOP } from "@/meet-core/stories/meet-story-shared";
import { MeetStoryScope } from "@/meet-core/stories/meet-story-scope";

const meta = {
  title: "Features/Meet/Components/MeetKnockBadge",
  component: MeetKnockBadge,
  render: (args) => (
    <MeetStoryScope variant="root">
      <div className="meet-call-bar p-4">
        <MeetKnockBadge {...args} />
      </div>
    </MeetStoryScope>
  ),
  parameters: meetStoryParameters({
    componentDescription:
      "Host admit control used by MeetCallKnockQueue. Guests waiting in an expanded stage see MeetCallKnockWaiting.",
  }),
} satisfies Meta<typeof MeetKnockBadge>;

export default meta;
type Story = StoryObj<typeof MeetKnockBadge>;

export const OneGuest: Story = {
  name: "One guest",
  args: {
    knockers: [STORY_MEET_KNOCKERS[0]!],
    onAdmit: STORY_NOOP,
    onDeny: STORY_NOOP,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(meetLabels.lobbyWaiting(1))).toBeInTheDocument();
    await expect(
      canvas.getByText(meetLabels.knockerWantsToJoin("Alex Morgan")),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: meetLabels.admitName("Alex Morgan") }),
    ).toBeInTheDocument();
    await expect(
      canvas.queryByRole("button", { name: meetLabels.waitingToJoin(1) }),
    ).not.toBeInTheDocument();
  },
};

export const MultipleGuests: Story = {
  name: "Multiple guests",
  args: {
    knockers: STORY_MEET_KNOCKERS,
    onAdmit: STORY_NOOP,
    onDeny: STORY_NOOP,
  },
};
