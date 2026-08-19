import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { CalendarInvitationsPanel } from "@/calendar-core/src/calendar-invitations-panel";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import type { CalendarSchedulingNotification } from "@/lib/api/wgw/calendar-scheduling";
import { TooltipProvider } from "@/ui/tooltip";
import "@/calendar-core/src/calendar-workspace.css";

const sample: CalendarSchedulingNotification = {
  id: "invite-1.ics",
  uid: "uid-standup",
  method: "REQUEST",
  title: "Standup",
  organizerEmail: "bob@example.test",
  organizerName: "Bob",
  start: "2026-08-20T14:00:00",
  end: "2026-08-20T15:00:00",
  location: "Room 4",
  color: "#0ea5e9",
  participationStatus: "needs-action",
  eventId: "invite-copy",
};

const canceled: CalendarSchedulingNotification = {
  ...sample,
  id: "invite-2.ics",
  uid: "uid-canceled",
  method: "CANCEL",
  title: "Design review",
  organizerName: "Ada",
  participationStatus: "needs-action",
};

const accepted: CalendarSchedulingNotification = {
  ...sample,
  id: "invite-3.ics",
  uid: "uid-planning",
  title: "Planning",
  organizerName: "Ada",
  participationStatus: "accepted",
  location: "HQ",
};

const maybe: CalendarSchedulingNotification = {
  ...sample,
  id: "invite-4.ics",
  uid: "uid-lunch",
  title: "Lunch",
  participationStatus: "tentative",
  color: "#6366f1",
};

const sampleCalendars = [
  { id: "default", name: "Personal", color: "#6366f1", isDefault: true },
  { id: "work", name: "Work", color: "#0ea5e9" },
];

const noop = () => {};

const meta: Meta<typeof CalendarInvitationsPanel> = {
  title: "Apps/Calendar/Invitations",
  component: CalendarInvitationsPanel,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Right-side invitations inbox: Docs collab chrome, Lit event-card body, and a New / Responded segmented filter.",
      },
    },
  },
  decorators: [
    (Story) => (
      <TooltipProvider>
        <div className="calendar-workspace h-[32rem] w-full max-w-sm border">
          <Story />
        </div>
      </TooltipProvider>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof CalendarInvitationsPanel>;

const panelHandlers = {
  labels: defaultCalendarLabels,
  locale: "en-US",
  calendars: sampleCalendars,
  defaultCalendarId: "default",
  onClose: noop,
  onRespond: noop,
  showCloseButton: true,
};

export const Default: Story = {
  tags: ["vitest-ci"],
  args: {
    ...panelHandlers,
    notifications: [sample, canceled, accepted, maybe],
  },
};

export const Responded: Story = {
  args: {
    ...panelHandlers,
    tab: "responded",
    notifications: [sample, canceled, accepted, maybe],
  },
};

export const Empty: Story = {
  args: {
    ...panelHandlers,
    notifications: [],
  },
};

function InteractivePanelDemo() {
  const [notifications, setNotifications] = useState<CalendarSchedulingNotification[]>([
    sample,
    canceled,
    accepted,
    maybe,
  ]);
  const [activeId, setActiveId] = useState<string | null>(sample.id);

  return (
    <CalendarInvitationsPanel
      {...panelHandlers}
      notifications={notifications}
      activeId={activeId}
      onSelect={setActiveId}
      onRespond={(id, status) => {
        setNotifications((current) =>
          current.map((row) => (row.id === id ? { ...row, participationStatus: status } : row)),
        );
        setActiveId(null);
      }}
    />
  );
}

export const Interactive: Story = {
  render: () => <InteractivePanelDemo />,
};
