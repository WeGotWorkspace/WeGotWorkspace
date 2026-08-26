import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { CalendarEventDialog } from "@/calendar-core/src/calendar-event-dialog";
import { emptyCalendarEventForm } from "@/calendar-core/src/calendar-editor-model";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import { createCalendarAppBootstrap } from "@/lib/api/mock/calendar-bootstrap";

const stubMeetOperations = {
  roomStatus: async () => ({ reserved: true, active: false }),
  reserveRoom: async () => ({ reserved: true, active: false }),
  patchRoomExpiresAt: async () => ({ reserved: true, active: false }),
};

function meetSwitch(canvas: ReturnType<typeof within>) {
  return canvas.getByRole("group", { name: defaultCalendarLabels.eventMeetAdd });
}

const bootstrap = createCalendarAppBootstrap();

const meta: Meta<typeof CalendarEventDialog> = {
  title: "Apps/Calendar/EventDialog",
  component: CalendarEventDialog,
  args: {
    open: true,
    mode: "create",
    form: { ...emptyCalendarEventForm("default", "2033-01-12"), title: "Lunch" },
    calendars: bootstrap.data.calendars,
    labels: defaultCalendarLabels,
    locale: "en-US",
    canSubmitEmail: true,
    sessionUsername: "bob",
    onChange: fn(),
    onClose: fn(),
    onSave: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof CalendarEventDialog>;

export const Default: Story = {
  tags: ["vitest-ci"],
  args: {
    meetOperations: stubMeetOperations,
    workspaceOrigin: "https://workspace.example.com",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    const toggle = meetSwitch(canvas);
    await expect(toggle).toHaveAttribute("data-state", "off");
    await expect(canvas.queryByRole("button", { name: "Add Meet" })).toBeNull();
    await expect(
      canvas.getByPlaceholderText(defaultCalendarLabels.eventLocationLabel),
    ).toBeTruthy();
  },
};

export const EmailUnavailable: Story = {
  args: {
    canSubmitEmail: false,
  },
};

export const InviteeViewOnly: Story = {
  args: {
    mode: "edit",
    sessionEmail: "carol@example.test",
    onRsvp: fn(),
    form: {
      ...emptyCalendarEventForm("default", "2033-01-12"),
      title: "Standup",
      attendees: [
        {
          email: "bob@example.test",
          name: "Bob",
          participationStatus: "accepted",
          isOrganizer: true,
        },
        {
          email: "carol@example.test",
          name: "Carol",
          participationStatus: "accepted",
          role: "required",
        },
      ],
    },
  },
};

export const WithMeetLink: Story = {
  tags: ["vitest-ci"],
  args: {
    form: {
      ...emptyCalendarEventForm("default", "2033-01-12"),
      title: "Standup",
      location: "Room A",
      meetingUrl: "https://workspace.example.com/meet/guest?room=h8y8-ewp6-al8n",
    },
    meetOperations: stubMeetOperations,
    workspaceOrigin: "https://workspace.example.com",
    onJoinMeeting: fn(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    const toggle = meetSwitch(canvas);
    await expect(toggle).toHaveAttribute("data-state", "on");
    await expect(canvas.getByDisplayValue("Room A")).toBeTruthy();
    await userEvent.click(toggle.querySelector('button[aria-label="Off"]')!);
    const confirm = canvas.getByRole("alertdialog");
    await expect(confirm).toHaveTextContent(defaultCalendarLabels.eventMeetDisableTitle);
    await expect(toggle).toHaveAttribute("data-state", "on");
    await userEvent.click(
      within(confirm).getByRole("button", { name: defaultCalendarLabels.cancel }),
    );
    await expect(canvas.queryByRole("alertdialog")).toBeNull();
  },
};

export const MeetReserving: Story = {
  tags: ["vitest-ci"],
  args: {
    meetOperations: {
      ...stubMeetOperations,
      reserveRoom: () => new Promise(() => {}),
    },
    workspaceOrigin: "https://workspace.example.com",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    const toggle = meetSwitch(canvas);
    await userEvent.click(toggle.querySelector('button[aria-label="On"]')!);
    await expect(toggle).toHaveAttribute("aria-disabled", "true");
    await expect(toggle.querySelector('button[aria-label="On"]')).toBeDisabled();
    await expect(toggle.querySelector('button[aria-label="Off"]')).toBeDisabled();
  },
};

export const InviteeMeetJoin: Story = {
  args: {
    mode: "edit",
    sessionEmail: "carol@example.test",
    onRsvp: fn(),
    workspaceOrigin: "https://workspace.example.com",
    onJoinMeeting: fn(),
    meetOperations: {
      roomStatus: async () => ({ reserved: true, active: false }),
    },
    form: {
      ...emptyCalendarEventForm("default", "2033-01-12"),
      title: "Standup",
      meetingUrl: "https://workspace.example.com/meet/guest?room=h8y8-ewp6-al8n",
      attendees: [
        {
          email: "bob@example.test",
          name: "Bob",
          participationStatus: "accepted",
          isOrganizer: true,
        },
        {
          email: "carol@example.test",
          name: "Carol",
          participationStatus: "accepted",
          role: "required",
        },
      ],
    },
  },
};

export const WithInvitees: Story = {
  args: {
    invitees: [
      { username: "wouter", email: "wouter@woutervroege.nl", name: "Wouter" },
      { username: "carol", email: "carol@example.test", name: "Carol" },
    ],
    sessionEmail: "admin@localhost",
    form: {
      ...emptyCalendarEventForm("default", "2033-01-12"),
      title: "Lunch",
      attendees: [
        {
          email: "admin@localhost",
          name: "Admin",
          participationStatus: "accepted",
          isOrganizer: true,
        },
        {
          email: "wouter@woutervroege.nl",
          name: "Wouter",
          participationStatus: "tentative",
          role: "required",
        },
        {
          email: "carol@example.test",
          name: "Carol",
          participationStatus: "accepted",
          role: "required",
        },
        {
          email: "dana@example.test",
          name: "Dana",
          participationStatus: "declined",
          role: "optional",
        },
        {
          email: "guest@elsewhere.test",
          name: "guest@elsewhere.test",
          participationStatus: "needs-action",
          role: "optional",
        },
      ],
    },
  },
};
