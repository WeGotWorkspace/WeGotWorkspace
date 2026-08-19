import type { Meta, StoryObj } from "@storybook/react-vite";
import { CalendarInvitationsSection } from "@/calendar-core/src/calendar-invitations-section";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";

const meta: Meta<typeof CalendarInvitationsSection> = {
  title: "Apps/Calendar/Invitations",
  component: CalendarInvitationsSection,
};

export default meta;
type Story = StoryObj<typeof CalendarInvitationsSection>;

const sample = {
  id: "invite-1.ics",
  uid: "uid-standup",
  method: "REQUEST",
  title: "Standup",
  organizerEmail: "bob@example.test",
  organizerName: "Bob",
  participationStatus: "needs-action" as const,
  eventId: "invite-copy",
};

export const Pending: Story = {
  tags: ["vitest-ci"],
  args: {
    notifications: [sample],
    labels: defaultCalendarLabels,
    onRespond: () => {},
    onDismiss: () => {},
  },
};

export const Empty: Story = {
  args: {
    notifications: [],
    labels: defaultCalendarLabels,
    onRespond: () => {},
    onDismiss: () => {},
  },
};
