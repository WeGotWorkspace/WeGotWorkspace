import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { CalendarEventDetailsPopover } from "@/calendar-core/src/calendar-event-details-popover";
import {
  invitationToEventPreview,
  type CalendarEventPreviewModel,
  type CalendarEventSelectionOrigin,
} from "@/calendar-core/src/calendar-event-preview";
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
  title: "Shared/Calendar/Invitations",
  component: CalendarInvitationsPanel,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Right-side invitations inbox: shared Docs collab chrome, Lit event-card body, and an icon-only New / Responded filter on the title row.",
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
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const card = canvasElement.querySelector("[data-invitation-id='invite-1.ics']");
    await expect(card).toBeTruthy();
    const headerActions = card?.querySelector(".docs-collab-card__actions");
    const rsvp = card?.querySelector(".calendar-invitation-card__actions .segmented-control");
    await expect(headerActions?.contains(rsvp ?? null)).toBe(false);
    await expect(rsvp?.classList.contains("segmented-control--unselected")).toBe(true);
    await expect(card?.querySelector(".segmented-control__button--active")).toBeNull();
    await expect(rsvp?.classList.contains("segmented-control--size-md")).toBe(true);
    for (const name of [
      defaultCalendarLabels.rsvpAccept,
      defaultCalendarLabels.rsvpMaybe,
      defaultCalendarLabels.rsvpDecline,
    ]) {
      const button = canvas.getByRole("button", { name });
      await expect(button).not.toHaveAttribute("aria-pressed", "true");
      await expect(button.classList.contains("segmented-control__button--text")).toBe(true);
      await expect(button).toHaveTextContent(name);
      await expect(button.querySelector("svg")).toBeTruthy();
    }
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

function InvitationPreviewHarness() {
  const [notifications, setNotifications] = useState<CalendarSchedulingNotification[]>([
    sample,
    canceled,
    accepted,
    maybe,
  ]);
  const [activeId, setActiveId] = useState<string | null>(sample.id);
  const [preview, setPreview] = useState<{
    model: CalendarEventPreviewModel;
    origin?: CalendarEventSelectionOrigin;
  } | null>(null);

  return (
    <>
      <CalendarInvitationsPanel
        {...panelHandlers}
        notifications={notifications}
        activeId={activeId}
        onSelect={setActiveId}
        onOpenEvent={(eventId, origin) => {
          const notification =
            notifications.find((row) => row.eventId === eventId || row.id === eventId) ?? sample;
          setPreview({
            model: invitationToEventPreview(notification, {
              untitledLabel: defaultCalendarLabels.untitledEvent,
              defaultCalendarId: "default",
            }),
            origin,
          });
        }}
        onRespond={(id, status) => {
          setNotifications((current) =>
            current.map((row) => (row.id === id ? { ...row, participationStatus: status } : row)),
          );
          setActiveId(null);
        }}
      />
      {preview ? (
        <CalendarEventDetailsPopover
          open
          preview={preview.model}
          origin={preview.origin}
          calendars={sampleCalendars}
          labels={defaultCalendarLabels}
          locale="en-US"
          untitledLabel={defaultCalendarLabels.untitledEvent}
          canEdit
          onClose={() => setPreview(null)}
        />
      ) : null}
    </>
  );
}

export const Interactive: Story = {
  tags: ["vitest-ci"],
  render: () => <InvitationPreviewHarness />,
  play: async ({ canvasElement }) => {
    const card = canvasElement.querySelector("[data-invitation-id='invite-1.ics']");
    await expect(card).toBeTruthy();
    await userEvent.click(card as HTMLElement);
    const body = within(canvasElement.ownerDocument.body);
    const popover = body.getByRole("dialog", { name: "Standup" });
    await expect(popover).toBeTruthy();
    await expect(
      within(popover).queryByRole("button", { name: defaultCalendarLabels.rsvpAccept }),
    ).toBeNull();
    await expect(
      within(popover).queryByRole("button", { name: defaultCalendarLabels.rsvpMaybe }),
    ).toBeNull();
    await expect(
      within(popover).queryByRole("button", { name: defaultCalendarLabels.rsvpDecline }),
    ).toBeNull();
    await expect(
      body.queryByRole("dialog", { name: defaultCalendarLabels.editEventTitle }),
    ).toBeNull();
  },
};
