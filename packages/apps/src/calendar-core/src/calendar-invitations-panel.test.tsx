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
        color?: string;
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
    const filter = screen.getByRole("group", {
      name: defaultCalendarLabels.invitationsFilterAria,
    });
    expect(filter.closest(".docs-collab-sidebar-panel__header-actions")).toBeTruthy();
    expect(document.querySelector(".docs-collab-sidebar-panel__toolbar")).toBeNull();
    expect(filter.className).toContain("segmented-control");
    expect(filter.className).not.toContain("segmented-control--size-lg");
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
    const headerActions = document.querySelector(
      "[data-invitation-id='invite-1.ics'] .docs-collab-card__actions",
    );
    const actions = document.querySelector(".calendar-invitation-card__actions");
    expect(headerActions?.contains(actions)).toBe(false);
    expect(actions?.className).toContain("calendar-rsvp-actions--sm");
    expect(actions?.className).not.toContain("calendar-rsvp-actions--xs");
    expect(actions?.className).not.toContain("calendar-rsvp-actions--lg");
    expect(actions?.querySelector(".segmented-control")).toBeTruthy();
    expect(actions?.querySelector(".segmented-control--size-md")).toBeTruthy();
    expect(actions?.querySelector(".segmented-control--unselected")).toBeTruthy();
    expect(accept.className).toContain("segmented-control__button--text");
    expect(maybe.className).toContain("segmented-control__button--text");
    expect(decline.className).toContain("segmented-control__button--text");
    expect(accept.textContent).toContain(defaultCalendarLabels.rsvpAccept);
    expect(maybe.textContent).toContain(defaultCalendarLabels.rsvpMaybe);
    expect(decline.textContent).toContain(defaultCalendarLabels.rsvpDecline);
    expect(accept.querySelector("svg")).toBeTruthy();
    expect(maybe.querySelector("svg")).toBeTruthy();
    expect(decline.querySelector("svg")).toBeTruthy();
    expect(accept.getAttribute("aria-pressed")).not.toBe("true");
    expect(maybe.getAttribute("aria-pressed")).not.toBe("true");
    expect(decline.getAttribute("aria-pressed")).not.toBe("true");
    expect(accept.className).not.toContain("segmented-control__button--active");
    expect(maybe.className).not.toContain("segmented-control__button--active");
    expect(decline.className).not.toContain("segmented-control__button--active");
    expect(document.querySelector(".calendar-invitation-card")).toBeTruthy();
    expect(document.querySelector(".calendar-invitation-card__rsvp")).toBeNull();
    expect(
      screen.queryByRole("button", { name: defaultCalendarLabels.invitationsDismiss }),
    ).toBeNull();
  });

  it("reuses the event-dialog calendar picker on new invites", () => {
    renderPanel();
    const trigger = screen.getByRole("button", { name: /Calendar: Personal/i });
    expect(trigger.className).toContain("color-swatch-trigger");
    expect(trigger.className).toContain("calendar-event-dialog__calendar-trigger");
    expect(trigger.className).toContain("calendar-invitation-card__calendar-trigger");
    expect(trigger.className).toContain("control-surface--size-md");
    expect(trigger.querySelector(".color-swatch-trigger__dot")).toBeTruthy();
    expect(trigger.querySelector(".color-swatch-trigger__chevron")).toBeTruthy();
    expect(trigger.querySelector(".color-swatch-trigger__caption")).toBeNull();
    expect(trigger.textContent?.trim()).toBe("");
    const actions = document.querySelector(
      "[data-invitation-id='invite-1.ics'] .docs-collab-card__actions",
    );
    const rsvp = document.querySelector(
      "[data-invitation-id='invite-1.ics'] .calendar-invitation-card__actions",
    );
    expect(actions?.contains(trigger)).toBe(true);
    expect(actions?.contains(rsvp)).toBe(false);
    const cluster = [...(actions?.children ?? [])];
    expect(cluster).toHaveLength(1);
    expect(cluster[0]?.className).toContain("calendar-invitation-card__calendar");
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
      screen
        .getByRole("button", { name: defaultCalendarLabels.rsvpAccept })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: defaultCalendarLabels.rsvpMaybe })
        .getAttribute("aria-pressed"),
    ).toBe("false");
    expect(
      screen
        .getByRole("button", { name: defaultCalendarLabels.rsvpDecline })
        .getAttribute("aria-pressed"),
    ).toBe("false");
    expect(screen.getByRole("button", { name: /Calendar: Personal/i })).toBeTruthy();
    const headerActions = document.querySelector(
      "[data-invitation-id='invite-3.ics'] .docs-collab-card__actions",
    );
    expect(headerActions?.querySelector(".calendar-invitation-card__calendar")).toBeTruthy();
    expect(headerActions?.querySelector(".calendar-invitation-card__actions")).toBeNull();
    const rsvp = document.querySelector(
      "[data-invitation-id='invite-3.ics'] .calendar-invitation-card__actions",
    );
    expect(rsvp).toBeTruthy();
    expect(headerActions?.contains(rsvp)).toBe(false);
  });

  it("keeps calendar picker local on needs-action until Accept", () => {
    const { onRespond } = renderPanel();
    const host = eventCardHost("invite-1.ics");
    expect(host?.getAttribute("color") ?? host?.color).toBe("#6366f1");

    const trigger = screen.getByRole("button", { name: /Calendar: Personal/i });
    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: /Work/i }));

    expect(onRespond).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Calendar: Work/i })).toBeTruthy();
    const after = eventCardHost("invite-1.ics");
    expect(after?.getAttribute("color") ?? after?.color).toBe("#0ea5e9");
  });

  it("persists calendar picker changes for already-accepted invites", () => {
    const { onRespond } = renderPanel({
      notifications: [accepted],
      tab: "responded",
    });

    const trigger = screen.getByRole("button", { name: /Calendar: Personal/i });
    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: /Work/i }));

    expect(onRespond).toHaveBeenCalledWith("invite-3.ics", "accepted", "work");
    expect(screen.getByRole("button", { name: /Calendar: Work/i })).toBeTruthy();
    const host = eventCardHost("invite-3.ics");
    expect(host?.getAttribute("color") ?? host?.color).toBe("#0ea5e9");
  });

  it("persists calendar picker changes for tentative invites", () => {
    const tentative: CalendarSchedulingNotification = {
      ...accepted,
      id: "invite-tentative.ics",
      uid: "uid-tentative",
      participationStatus: "tentative",
    };
    const { onRespond } = renderPanel({
      notifications: [tentative],
      tab: "responded",
    });

    const trigger = screen.getByRole("button", { name: /Calendar: Personal/i });
    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: /Work/i }));

    expect(onRespond).toHaveBeenCalledWith("invite-tentative.ics", "tentative", "work");
  });

  it("reverts the calendar picker when persist rejects", async () => {
    const onRespond = vi.fn().mockRejectedValue(new Error("Could not move event"));
    renderPanel({
      notifications: [accepted],
      tab: "responded",
      onRespond,
    });

    const trigger = screen.getByRole("button", { name: /Calendar: Personal/i });
    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: /Work/i }));

    expect(onRespond).toHaveBeenCalledWith("invite-3.ics", "accepted", "work");
    await vi.waitFor(() => {
      expect(screen.getByRole("button", { name: /Calendar: Personal/i })).toBeTruthy();
    });
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
    const { onRespond, onOpenEvent } = renderPanel({ defaultCalendarId: "work" });
    expect(screen.getByRole("button", { name: /Calendar: Work/i })).toBeTruthy();
    const accept = screen.getByRole("button", { name: defaultCalendarLabels.rsvpAccept });
    const maybe = screen.getByRole("button", { name: defaultCalendarLabels.rsvpMaybe });
    const decline = screen.getByRole("button", { name: defaultCalendarLabels.rsvpDecline });
    expect(accept.getAttribute("aria-pressed")).not.toBe("true");
    fireEvent.click(accept);
    expect(onRespond).toHaveBeenCalledWith("invite-1.ics", "accepted", "work");
    expect(onOpenEvent).not.toHaveBeenCalled();
    expect(accept.getAttribute("aria-pressed")).toBe("true");
    expect(accept.className).toContain("segmented-control__button--active");
    expect(maybe.getAttribute("aria-pressed")).toBe("false");
    expect(decline.getAttribute("aria-pressed")).toBe("false");
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

  it("keeps other invitation RSVP controls enabled while one respond is in flight", () => {
    let release: (() => void) | undefined;
    const onRespond = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const second: CalendarSchedulingNotification = {
      ...request,
      id: "invite-other.ics",
      uid: "uid-other",
      title: "Other invite",
      eventId: "invite-other",
    };
    renderPanel({ notifications: [request, second], onRespond });

    const accepts = screen.getAllByRole("button", { name: defaultCalendarLabels.rsvpAccept });
    expect(accepts).toHaveLength(2);
    fireEvent.click(accepts[0]!);

    expect(onRespond).toHaveBeenCalledTimes(1);
    for (const accept of accepts) {
      expect(accept.hasAttribute("disabled")).toBe(false);
    }
    for (const maybe of screen.getAllByRole("button", {
      name: defaultCalendarLabels.rsvpMaybe,
    })) {
      expect(maybe.hasAttribute("disabled")).toBe(false);
    }
    release?.();
  });

  it("opens event details when the card is selected", () => {
    const { onOpenEvent } = renderPanel();
    const card = document.querySelector("[data-invitation-id='invite-1.ics']") as HTMLElement;
    const eventCard = card.querySelector("event-card") as HTMLElement;
    eventCard.getBoundingClientRect = () =>
      ({
        left: 12,
        top: 80,
        width: 280,
        height: 64,
        right: 292,
        bottom: 144,
        x: 12,
        y: 80,
        toJSON: () => ({}),
      }) as DOMRect;
    fireEvent.click(card);
    expect(onOpenEvent).toHaveBeenCalledWith("invite-copy", {
      left: 12,
      top: 80,
      width: 280,
      height: 64,
    });
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

  it("sets recurring on the event-card for series a11y", () => {
    renderPanel({ notifications: [{ ...request, recurring: true }] });
    expect(eventCardHost("invite-1.ics")?.recurring).toBe(true);
  });

  it("does not show the series hint on invitation cards", () => {
    renderPanel({ notifications: [{ ...request, recurring: true }] });
    expect(screen.queryByText(defaultCalendarLabels.rsvpSeriesHint)).toBeNull();
    expect(document.querySelector(".calendar-invitation-card__rsvp-hint")).toBeNull();
  });

  it("does not show Meet Join on invitation cards", () => {
    renderPanel({
      notifications: [
        {
          ...request,
          url: "https://workspace.example.com/meet/guest?room=h8y8-ewp6-al8n",
        },
      ],
    });
    expect(screen.queryByRole("button", { name: defaultCalendarLabels.eventMeetJoin })).toBeNull();
    expect(document.querySelector(".calendar-invitation-card__meet")).toBeNull();
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
  it("imports CalendarEventCalendarPicker from the event form and invite card", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const form = readFileSync(join(here, "calendar-event-form.tsx"), "utf8");
    const title = readFileSync(join(here, "calendar-event-form-title.tsx"), "utf8");
    const card = readFileSync(join(here, "calendar-invitation-card.tsx"), "utf8");
    const importLine = 'from "@/calendar-core/src/calendar-event-calendar-picker"';
    expect(form).toContain("CalendarEventFormTitle");
    expect(title).toContain(importLine);
    expect(card).toContain(importLine);
  });

  it("refetches invitations when the inbox trigger opens the panel", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const workspace = readFileSync(join(here, "calendar-workspace.tsx"), "utf8");
    expect(workspace).toContain("onToggle={toggleInvitationsOpen}");
    expect(workspace).toContain("refreshIfIdle");
    expect(workspace).toContain("onOpenEvent={openInvitationPreview}");
    expect(workspace).toContain("invitation: true");
    expect(workspace).not.toMatch(/onOpenEvent=\{[\s\S]*openEditEventKey/);
  });

  it("reuses RSVP controls from calendar-rsvp-actions in the event form and invite card", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const form = readFileSync(join(here, "calendar-event-form.tsx"), "utf8");
    const footer = readFileSync(join(here, "calendar-event-form-footer.tsx"), "utf8");
    const card = readFileSync(join(here, "calendar-invitation-card.tsx"), "utf8");
    const importLine = 'from "@/calendar-core/src/calendar-rsvp-actions"';
    expect(form).toContain(importLine);
    expect(form).toContain("CalendarEventFormFooter");
    expect(footer).toContain(importLine);
    expect(footer).toContain("CalendarRsvpSelect");
    expect(footer).toMatch(
      /calendar-event-dialog__invitation-rsvp[\s\S]*CalendarRsvpActions[\s\S]*size="sm"[\s\S]*showLabels/,
    );
    expect(card).toContain(importLine);
    expect(card).toContain("CalendarRsvpActions");
    expect(card).toMatch(/DocsCollabCardHeader[\s\S]*event-card[\s\S]*CalendarRsvpActions/);
    expect(card).toMatch(/CalendarRsvpActions[\s\S]*size="sm"[\s\S]*showLabels/);
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
    expect(button.className).toMatch(/button--variant-outline/);
    expect(button.className).not.toMatch(/button--variant-subtle/);
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("marks the open inbox control active for outline tint", () => {
    render(
      <TooltipProvider>
        <CalendarInvitationsTrigger
          count={0}
          open
          labels={defaultCalendarLabels}
          onToggle={() => {}}
        />
      </TooltipProvider>,
    );

    const button = screen.getByRole("button", {
      name: defaultCalendarLabels.invitationsToggleHide,
    });
    expect(button.className).toMatch(/button--variant-outline/);
    expect(button.className).toMatch(/icon-button--active/);
    expect(button.getAttribute("aria-pressed")).toBe("true");
  });
});
