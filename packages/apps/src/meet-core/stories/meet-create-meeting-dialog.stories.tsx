import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import { CALENDAR_MEET_LINK_KEY } from "@/calendar-core/src/calendar-meet-link";
import { createCalendarAppBootstrap } from "@/lib/api/mock/calendar-bootstrap";
import { MeetCreateMeetingDialog } from "@/meet-core/src/meet-create-meeting-dialog";
import { meetLabels } from "@/meet-core/src/meet-labels";
import { MeetStoryScope } from "@/meet-core/stories/meet-story-scope";

const bootstrap = createCalendarAppBootstrap();

const stubMeetOperations = {
  roomStatus: async () => ({ reserved: true, active: false }),
  reserveRoom: async () => ({ reserved: true, active: false }),
  patchRoomExpiresAt: async () => ({ reserved: true, active: false }),
};

function DialogHarness() {
  return (
    <MeetStoryScope>
      <MeetCreateMeetingDialog
        open
        calendars={bootstrap.data.calendars}
        createEvent={async (draft) => ({
          "@type": "Event",
          id: "story-created",
          uid: "urn:uuid:story-created",
          calendarIds: { [draft.calendarId]: true },
          title: draft.title,
          start: draft.start,
          duration: draft.duration,
          links: draft.links,
        })}
        meetOperations={stubMeetOperations}
        sessionUsername="demo.user"
        sessionDisplayName="Demo User"
        onClose={() => {}}
      />
    </MeetStoryScope>
  );
}

const meta: Meta<typeof MeetCreateMeetingDialog> = {
  title: "Apps/Meet/Components/MeetCreateMeetingDialog",
  component: MeetCreateMeetingDialog,
};

export default meta;
type Story = StoryObj<typeof MeetCreateMeetingDialog>;

export const Instant: Story = {
  render: () => <DialogHarness />,
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await expect(body.getByRole("heading", { name: meetLabels.newMeeting })).toBeInTheDocument();
    await expect(body.getByLabelText(defaultCalendarLabels.eventTitleLabel)).toHaveValue("");
    const meetLink = body.getByLabelText(
      defaultCalendarLabels.eventMeetUrlLabel,
    ) as HTMLInputElement;
    await expect(meetLink.value).toMatch(/\/meet\/meetings\//);
    await expect(meetLink.value).not.toMatch(/\/guest/);
    await expect(body.getByRole("button", { name: meetLabels.createChannelButton })).toBeDisabled();
    await expect(body.getByRole("switch", { name: meetLabels.scheduleMeeting })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    await expect(
      body.queryByText(defaultCalendarLabels.eventWhenSectionTitle),
    ).not.toBeInTheDocument();
    await expect(body.getByRole("button", { name: /Calendar: Personal/i })).toBeInTheDocument();
    await userEvent.click(body.getByRole("button", { name: /Calendar: Personal/i }));
    await expect(body.getByRole("menuitem", { name: "Work" })).toBeInTheDocument();
    await expect(
      body.queryByRole("button", { name: defaultCalendarLabels.eventMeetAdd }),
    ).not.toBeInTheDocument();
  },
};

export const Scheduled: Story = {
  render: () => <DialogHarness />,
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(body.getByRole("switch", { name: meetLabels.scheduleMeeting }));
    const meetLink = body.getByLabelText(
      defaultCalendarLabels.eventMeetUrlLabel,
    ) as HTMLInputElement;
    await expect(meetLink.value).toMatch(/\/meet\/meetings\//);
    await expect(meetLink.value).not.toMatch(/\/guest/);
    await expect(body.getByRole("button", { name: meetLabels.createChannelButton })).toBeDisabled();
    await expect(body.getByText(defaultCalendarLabels.eventWhenSectionTitle)).toBeInTheDocument();
    await expect(body.getByText(defaultCalendarLabels.eventAttendeesLabel)).toBeInTheDocument();
    await expect(body.getByText(defaultCalendarLabels.eventNotesLabel)).toBeInTheDocument();
    const calendarTrigger = body.getByRole("button", { name: /Calendar: Personal/i });
    await expect(calendarTrigger).toBeInTheDocument();
    await userEvent.click(calendarTrigger);
    await expect(body.getByRole("menuitem", { name: "Work" })).toBeInTheDocument();
  },
};

export const Edit: Story = {
  render: () => (
    <MeetStoryScope>
      <MeetCreateMeetingDialog
        open
        mode="edit"
        event={{
          "@type": "Event",
          id: "cal-standup",
          uid: "urn:uuid:cal-standup",
          calendarIds: { default: true },
          title: "Standup",
          start: "2033-01-12T14:00:00",
          duration: "PT30M",
          timeZone: "Etc/UTC",
          links: {
            [CALENDAR_MEET_LINK_KEY]: {
              "@type": "Link",
              href: "https://workspace.example.com/meet/meetings/standup",
            },
          },
        }}
        channel={{
          id: "meeting-standup",
          name: "Standup",
          kind: "meeting",
          scope: "personal",
          guestRoomCode: "h8y8-ewp6-al8n",
        }}
        calendars={bootstrap.data.calendars}
        patchEvent={async (id, patch) => ({
          "@type": "Event",
          id,
          uid: `urn:uuid:${id}`,
          calendarIds: { default: true },
          title: typeof patch.title === "string" ? patch.title : "Standup",
          start: typeof patch.start === "string" ? patch.start : "2033-01-12T14:00:00",
          duration: typeof patch.duration === "string" ? patch.duration : "PT30M",
        })}
        meetOperations={stubMeetOperations}
        sessionUsername="demo.user"
        sessionDisplayName="Demo User"
        onClose={() => {}}
        onDelete={() => {}}
      />
    </MeetStoryScope>
  ),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await expect(body.getByRole("heading", { name: meetLabels.editMeeting })).toBeInTheDocument();
    await expect(body.getByLabelText(defaultCalendarLabels.eventTitleLabel)).toHaveValue("Standup");
    await expect(body.getByRole("button", { name: meetLabels.saveChannelButton })).toBeEnabled();
    await expect(
      body.queryByRole("switch", { name: meetLabels.scheduleMeeting }),
    ).not.toBeInTheDocument();
    await expect(body.getByText(defaultCalendarLabels.eventWhenSectionTitle)).toBeInTheDocument();
    await expect(body.getByText(defaultCalendarLabels.eventAttendeesLabel)).toBeInTheDocument();
    await expect(
      body.getByRole("button", { name: defaultCalendarLabels.delete }),
    ).toBeInTheDocument();
    const calendarTrigger = body.getByRole("button", { name: /Calendar: Personal/i });
    await expect(calendarTrigger).toBeInTheDocument();
    await userEvent.click(calendarTrigger);
    await expect(body.getByRole("menuitem", { name: "Work" })).toBeInTheDocument();
  },
};
