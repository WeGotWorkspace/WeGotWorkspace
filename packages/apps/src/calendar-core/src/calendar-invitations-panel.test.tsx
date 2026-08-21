import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarInvitationsPanel } from "@/calendar-core/src/calendar-invitations-panel";
import { CalendarInvitationsTrigger } from "@/calendar-core/src/calendar-invitations-trigger";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import { createCalendarAppBootstrap } from "@/lib/api/mock/calendar-bootstrap";
import type { CalendarSchedulingNotification } from "@/lib/api/wgw/calendar-scheduling";
import { TooltipProvider } from "@/ui/tooltip";

const request: CalendarSchedulingNotification = {
  id: "invite-1.ics",
  uid: "uid-1",
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

const cancelNotice: CalendarSchedulingNotification = {
  ...request,
  id: "invite-2.ics",
  uid: "uid-2",
  method: "CANCEL",
  title: "Canceled standup",
};

const accepted: CalendarSchedulingNotification = {
  ...request,
  id: "invite-3.ics",
  uid: "uid-3",
  method: "REQUEST",
  title: "Planning",
  participationStatus: "accepted",
};

const calendars = createCalendarAppBootstrap().data.calendars;

function mockReducedMotion() {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function eventCardHost(invitationId: string) {
  const card = document.querySelector(`[data-invitation-id="${invitationId}"]`);
  return (card?.querySelector("event-card") ?? null) as
    | (HTMLElement & {
        summary?: string;
        rsvp?: string;
        past?: boolean;
        time?: string;
        recurring?: boolean;
      })
    | null;
}

function renderPanel(overrides: Partial<ComponentProps<typeof CalendarInvitationsPanel>> = {}) {
  const onClose = vi.fn();
  const onRespond = vi.fn();
  const onOpenEvent = vi.fn();
  render(
    <TooltipProvider>
      <CalendarInvitationsPanel
        notifications={[request]}
        labels={defaultCalendarLabels}
        locale="en-US"
        calendars={calendars}
        defaultCalendarId="default"
        onClose={onClose}
        onRespond={onRespond}
        onOpenEvent={onOpenEvent}
        {...overrides}
      />
    </TooltipProvider>,
  );
  return { onClose, onRespond, onOpenEvent };
}

afterEach(() => {
  cleanup();
});

describe("CalendarInvitationsPanel", () => {
  beforeEach(() => {
    mockReducedMotion();
  });

  it("renders invitation cards with organizer, event-card body, and RSVP actions", () => {
    renderPanel();

    expect(
      screen.getByRole("complementary", { name: defaultCalendarLabels.invitationsSection }),
    ).toBeTruthy();
    expect(screen.queryByText(defaultCalendarLabels.invitationsCountOne)).toBeNull();
    expect(
      screen.getByRole("heading", { name: defaultCalendarLabels.invitationsSection }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: defaultCalendarLabels.invitationsTabNew }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: defaultCalendarLabels.invitationsTabResponded }),
    ).toBeTruthy();
    expect(screen.getByText("Bob")).toBeTruthy();
    const host = eventCardHost("invite-1.ics");
    expect(host?.summary).toBe("Standup");
    expect(host?.rsvp ?? "").toBe("");
    expect(host?.hasAttribute("rsvp")).toBe(false);
    const accept = screen.getByRole("button", { name: defaultCalendarLabels.rsvpAccept });
    const maybe = screen.getByRole("button", { name: defaultCalendarLabels.rsvpMaybe });
    const decline = screen.getByRole("button", { name: defaultCalendarLabels.rsvpDecline });
    expect(accept.className).toContain("calendar-invitation-card__action--accept");
    expect(maybe.className).toContain("calendar-invitation-card__action--maybe");
    expect(decline.className).toContain("calendar-invitation-card__action--decline");
    const actions = document.querySelector(".calendar-invitation-card__actions");
    expect(actions?.className).toContain("calendar-rsvp-actions--sm");
    expect(actions?.className).not.toContain("calendar-rsvp-actions--lg");
    expect(accept.className).toContain("calendar-rsvp-action--sm");
    expect(accept.className).not.toContain("calendar-invitation-card__action--selected");
    expect(maybe.className).not.toContain("calendar-invitation-card__action--selected");
    expect(decline.className).not.toContain("calendar-invitation-card__action--selected");
    expect(document.querySelector(".calendar-invitation-card")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: defaultCalendarLabels.invitationsDismiss }),
    ).toBeNull();
  });

  it("reuses the event-dialog calendar picker on new invites", () => {
    renderPanel();
    const trigger = screen.getByRole("button", { name: /Calendar: Personal/i });
    expect(trigger.className).toContain("calendar-color-swatch-trigger");
    expect(trigger.className).toContain("calendar-event-dialog__calendar-trigger");
    expect(trigger.className).toContain("calendar-invitation-card__calendar-trigger");
    expect(trigger.querySelector(".calendar-color-swatch-trigger__dot")).toBeTruthy();
    expect(trigger.querySelector(".calendar-color-swatch-trigger__chevron")).toBeTruthy();
    const actions = document.querySelector(
      "[data-invitation-id='invite-1.ics'] .docs-collab-card__actions",
    );
    expect(actions?.contains(trigger)).toBe(true);
  });

  it("uses the docs comments empty chrome", () => {
    renderPanel({ notifications: [] });

    const empty = screen.getByText(defaultCalendarLabels.invitationsEmpty);
    expect(empty.className).toContain("docs-collab-sidebar-panel__empty");
    expect(screen.queryByText(defaultCalendarLabels.invitationsCountMany(0))).toBeNull();
  });

  it("switches to responded invitations", () => {
    renderPanel({ notifications: [request, accepted] });

    expect(eventCardHost("invite-1.ics")?.summary).toBe("Standup");
    expect(eventCardHost("invite-3.ics")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: defaultCalendarLabels.invitationsTabResponded }),
    );

    expect(screen.queryByText(defaultCalendarLabels.invitationsRespondedCountOne)).toBeNull();
    expect(eventCardHost("invite-3.ics")?.summary).toBe("Planning");
    expect(eventCardHost("invite-1.ics")).toBeNull();
    expect(
      screen.getByRole("button", { name: defaultCalendarLabels.rsvpAccept }).className,
    ).toContain("calendar-invitation-card__action--selected");
    expect(
      screen.getByRole("button", { name: defaultCalendarLabels.rsvpMaybe }).className,
    ).not.toContain("calendar-invitation-card__action--selected");
    expect(
      screen.getByRole("button", { name: defaultCalendarLabels.rsvpDecline }).className,
    ).not.toContain("calendar-invitation-card__action--selected");
    expect(screen.queryByRole("button", { name: /Calendar: Personal/i })).toBeNull();
  });

  it("shows RSVP actions when METHOD is missing or lowercase on a new REQUEST", () => {
    renderPanel({
      notifications: [
        { ...request, method: "" },
        { ...request, id: "invite-1b.ics", uid: "uid-1b", method: "request" },
      ],
    });

    expect(screen.getAllByRole("button", { name: defaultCalendarLabels.rsvpAccept })).toHaveLength(
      2,
    );
    expect(screen.getAllByRole("button", { name: defaultCalendarLabels.rsvpMaybe })).toHaveLength(
      2,
    );
    expect(screen.getAllByRole("button", { name: defaultCalendarLabels.rsvpDecline })).toHaveLength(
      2,
    );
    expect(
      screen.queryByRole("button", { name: defaultCalendarLabels.invitationsDismiss }),
    ).toBeNull();
  });

  it("calls onRespond with the selected calendar on Accept", () => {
    const { onRespond } = renderPanel({ defaultCalendarId: "work" });
    expect(screen.getByRole("button", { name: /Calendar: Work/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: defaultCalendarLabels.rsvpAccept }));
    expect(onRespond).toHaveBeenCalledWith("invite-1.ics", "accepted", "work");
  });

  it("defaults Accept to the default calendar and omits it on Decline", () => {
    const { onRespond } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: defaultCalendarLabels.rsvpAccept }));
    expect(onRespond).toHaveBeenCalledWith("invite-1.ics", "accepted", "default");

    cleanup();
    const next = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: defaultCalendarLabels.rsvpDecline }));
    expect(next.onRespond).toHaveBeenCalledWith("invite-1.ics", "declined", undefined);
  });

  it("opens the event when the card is selected", () => {
    const { onOpenEvent } = renderPanel();
    fireEvent.click(document.querySelector("[data-invitation-id='invite-1.ics']")!);
    expect(onOpenEvent).toHaveBeenCalledWith("invite-copy");
  });

  it("hides cancelled organizer notices from the invitee inbox", () => {
    renderPanel({ notifications: [cancelNotice] });
    expect(eventCardHost("invite-2.ics")).toBeNull();
    expect(screen.getByText(defaultCalendarLabels.invitationsEmpty)).toBeTruthy();
    expect(screen.queryByRole("button", { name: defaultCalendarLabels.rsvpAccept })).toBeNull();
  });

  it("does not repeat the event datetime in the card header", () => {
    renderPanel();
    const card = document.querySelector("[data-invitation-id='invite-1.ics']");
    expect(card?.querySelector(".docs-collab-card__time")).toBeNull();
    expect(eventCardHost("invite-1.ics")?.time).toMatch(/Thu, Aug 20/);
  });

  it("sets recurring on the event-card so the repeat icon can render", () => {
    renderPanel({ notifications: [{ ...request, recurring: true }] });
    expect(eventCardHost("invite-1.ics")?.recurring).toBe(true);
  });

  it("discloses that sidebar RSVP applies to the entire series when recurring", () => {
    renderPanel({ notifications: [{ ...request, recurring: true }] });
    expect(screen.getByText(defaultCalendarLabels.rsvpSeriesHint)).toBeTruthy();
  });

  it("does not show the series hint on a one-off invitation", () => {
    renderPanel();
    expect(screen.queryByText(defaultCalendarLabels.rsvpSeriesHint)).toBeNull();
  });

  it("closes from the panel header", () => {
    const { onClose } = renderPanel({ showCloseButton: true });
    fireEvent.click(screen.getByLabelText(defaultCalendarLabels.invitationsClosePanel));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not show a tooltip when the drawer close control is focused", () => {
    render(
      <TooltipProvider delayDuration={0}>
        <CalendarInvitationsPanel
          notifications={[request]}
          labels={defaultCalendarLabels}
          locale="en-US"
          calendars={calendars}
          defaultCalendarId="default"
          showCloseButton
          onClose={vi.fn()}
          onRespond={vi.fn()}
        />
      </TooltipProvider>,
    );
    screen.getByLabelText(defaultCalendarLabels.invitationsClosePanel).focus();
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});

describe("calendar invitation picker reuse", () => {
  it("imports CalendarEventCalendarPicker from the event dialog and invite card", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const dialog = readFileSync(join(here, "calendar-event-dialog.tsx"), "utf8");
    const card = readFileSync(join(here, "calendar-invitation-card.tsx"), "utf8");
    const importLine = 'from "@/calendar-core/src/calendar-event-calendar-picker"';
    expect(dialog).toContain(importLine);
    expect(card).toContain(importLine);
  });

  it("refetches invitations when the inbox trigger opens the panel", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const workspace = readFileSync(join(here, "calendar-workspace.tsx"), "utf8");
    expect(workspace).toContain("onToggle={toggleInvitationsOpen}");
    expect(workspace).toContain("refreshIfIdle");
  });

  it("reuses RSVP controls from calendar-rsvp-actions in the dialog and invite card", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const dialog = readFileSync(join(here, "calendar-event-dialog.tsx"), "utf8");
    const card = readFileSync(join(here, "calendar-invitation-card.tsx"), "utf8");
    const importLine = 'from "@/calendar-core/src/calendar-rsvp-actions"';
    expect(dialog).toContain(importLine);
    expect(dialog).toContain("CalendarRsvpSelect");
    expect(card).toContain(importLine);
    expect(card).toContain("CalendarRsvpActions");
  });
});

describe("CalendarInvitationsTrigger", () => {
  it("exposes the pending count on the header control", () => {
    const onToggle = vi.fn();
    render(
      <TooltipProvider>
        <CalendarInvitationsTrigger
          count={3}
          open={false}
          labels={defaultCalendarLabels}
          onToggle={onToggle}
        />
      </TooltipProvider>,
    );

    const button = screen.getByRole("button", {
      name: `${defaultCalendarLabels.invitationsToggleShow} (3)`,
    });
    expect(button.getAttribute("data-count")).toBe("3");
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
