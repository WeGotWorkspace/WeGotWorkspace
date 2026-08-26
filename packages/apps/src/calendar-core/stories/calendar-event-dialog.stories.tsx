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

function generateMeet(canvas: ReturnType<typeof within>) {
  return canvas.getByRole("button", { name: defaultCalendarLabels.eventMeetAdd });
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
    await expect(generateMeet(canvas)).toBeEnabled();
    await expect(canvas.getByLabelText(defaultCalendarLabels.eventMeetUrlLabel)).toBeTruthy();
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
    await expect(generateMeet(canvas)).toBeEnabled();
    await userEvent.click(generateMeet(canvas));
    const confirm = canvas.getByRole("alertdialog");
    await expect(confirm).toHaveTextContent(defaultCalendarLabels.eventMeetDisableTitle);
    await userEvent.click(
      within(confirm).getByRole("button", { name: defaultCalendarLabels.cancel }),
    );
    await expect(canvas.queryByRole("alertdialog")).toBeNull();
    await expect(canvas.getByDisplayValue("Room A")).toBeTruthy();
    const url = canvas.getByLabelText(defaultCalendarLabels.eventMeetUrlLabel) as HTMLInputElement;
    await expect(url.value).toBe("https://workspace.example.com/meet/guest?room=h8y8-ewp6-al8n");
    await expect(url.readOnly).toBe(false);
    await expect(
      canvas.getByRole("button", { name: defaultCalendarLabels.copyHttpsUrl }),
    ).toBeTruthy();
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
    await userEvent.click(generateMeet(canvas));
    const generate = generateMeet(canvas);
    await expect(generate).toBeDisabled();
    await expect(generate.querySelector(".loading-spinner")).toBeTruthy();
    await expect(
      canvas.getByLabelText(defaultCalendarLabels.eventMeetUrlLabel).className,
    ).not.toContain("share-dialog__input--mono");
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
