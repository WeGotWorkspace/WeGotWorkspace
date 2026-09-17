import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { CalendarMeetChannelEmailDialog } from "@/calendar-core/src/calendar-meet-channel-email-dialog";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";

const meta: Meta<typeof CalendarMeetChannelEmailDialog> = {
  title: "Apps/Calendar/MeetChannelEmailDialog",
  component: CalendarMeetChannelEmailDialog,
  args: {
    open: true,
    labels: defaultCalendarLabels,
    onOpenChange: fn(),
    onChoice: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof CalendarMeetChannelEmailDialog>;

export const Default: Story = {
  tags: ["vitest-ci"],
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    const dialog = canvas.getByRole("alertdialog");
    await expect(dialog).toHaveTextContent(defaultCalendarLabels.eventMeetChannelEmailTitle);
    await expect(dialog).toHaveTextContent(defaultCalendarLabels.eventMeetChannelEmailDescription);
    await expect(canvas.queryByRole("button", { name: defaultCalendarLabels.cancel })).toBeNull();
    await expect(
      canvas.getByRole("button", { name: defaultCalendarLabels.eventMeetChannelEmailKeepBoth }),
    ).toHaveTextContent("Ignore");
    await expect(
      canvas.getByRole("button", { name: defaultCalendarLabels.eventMeetChannelEmailStripEmails }),
    ).toHaveTextContent("Remove Email Invites");
    const meetingLink = canvas.getByRole("button", {
      name: defaultCalendarLabels.eventMeetChannelEmailReplaceLink,
    });
    await expect(meetingLink).toHaveTextContent("Use Meeting Link");
    await expect(meetingLink.className).toMatch(/button--variant-primary/);
    await userEvent.click(meetingLink);
    await expect(args.onChoice).toHaveBeenCalledWith("replace-with-room");
  },
};

export const MeetStyled: Story = {
  args: {
    contentClassName: "meet-channel-dialog calendar-dialog-surface",
  },
};
