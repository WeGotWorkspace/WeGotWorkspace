import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CALENDAR_MEET_LINK_KEY } from "@/calendar-core/src/calendar-meet-link";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import { createCalendarAppBootstrap } from "@/lib/api/mock/calendar-bootstrap";
import { MeetCreateMeetingDialog } from "@/meet-core/src/meet-create-meeting-dialog";
import { meetLabels } from "@/meet-core/src/meet-labels";
import { TooltipProvider } from "@/ui/tooltip";

const ORIGIN = "https://workspace.example.com";
const bootstrap = createCalendarAppBootstrap();

function renderDialog(overrides: Partial<ComponentProps<typeof MeetCreateMeetingDialog>> = {}) {
  const createEvent = vi.fn().mockResolvedValue({ id: "created-1" });
  const createChannel = vi.fn().mockResolvedValue({
    id: "chat-01h455vb4pa9nnrjpznsav8hva",
    name: "Standup",
    kind: "meeting",
    guestRoomCode: null,
  });
  const meetOperations = {
    roomStatus: vi.fn().mockResolvedValue({ reserved: true, active: false }),
    reserveRoom: vi.fn().mockResolvedValue({ reserved: true, active: false }),
    patchRoomExpiresAt: vi.fn().mockResolvedValue({ reserved: true, active: false }),
  };
  const onClose = vi.fn();
  const onCreated = vi.fn();
  render(
    <TooltipProvider delayDuration={0}>
      <MeetCreateMeetingDialog
        open
        calendars={bootstrap.data.calendars}
        createEvent={createEvent}
        createChannel={createChannel}
        meetOperations={meetOperations}
        sessionUsername="demo.user"
        sessionDisplayName="Demo User"
        workspaceOrigin={ORIGIN}
        onClose={onClose}
        onCreated={onCreated}
        {...overrides}
      />
    </TooltipProvider>,
  );
  return { createEvent, createChannel, meetOperations, onClose, onCreated };
}

describe("MeetCreateMeetingDialog", () => {
  beforeEach(() => {
    cleanup();
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it("reserves a link and creates a 30-minute event on the default calendar", async () => {
    const { createEvent, createChannel, meetOperations } = renderDialog();

    await waitFor(() => expect(meetOperations.reserveRoom).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText(defaultCalendarLabels.eventTitleLabel), {
      target: { value: "Standup" },
    });
    const create = await screen.findByRole("button", { name: meetLabels.createChannelButton });
    await waitFor(() => expect(create.hasAttribute("disabled")).toBe(false));
    fireEvent.click(create);

    await waitFor(() => expect(createEvent).toHaveBeenCalledTimes(1));
    const draft = createEvent.mock.calls[0]?.[0] as {
      calendarId: string;
      duration: string;
      title: string;
      links?: Record<string, { href?: string }>;
    };
    expect(draft.calendarId).toBe("default");
    expect(draft.duration).toBe("PT30M");
    expect(draft.title).toBe("Standup");
    expect(createChannel).toHaveBeenCalledWith({ name: "Standup", kind: "meeting" });
    expect(draft.links?.[CALENDAR_MEET_LINK_KEY]?.href).toMatch(/\/meet\/meetings\//);
    expect(draft.links?.[CALENDAR_MEET_LINK_KEY]?.href).not.toMatch(/chat-/);
    expect(draft.links?.[CALENDAR_MEET_LINK_KEY]?.href).not.toMatch(/\/guest/);
  });

  it("shows a unified Meet URL immediately with an empty title, even while reserve is in flight", async () => {
    let resolveReserve: ((value: { reserved: boolean; active: boolean }) => void) | undefined;
    const reserveRoom = vi.fn(
      () =>
        new Promise<{ reserved: boolean; active: boolean }>((resolve) => {
          resolveReserve = resolve;
        }),
    );
    renderDialog({
      meetOperations: {
        roomStatus: vi.fn().mockResolvedValue({ reserved: true, active: false }),
        reserveRoom,
        patchRoomExpiresAt: vi.fn().mockResolvedValue({ reserved: true, active: false }),
      },
    });

    const title = screen.getByLabelText(defaultCalendarLabels.eventTitleLabel);
    const link = screen.getByLabelText(defaultCalendarLabels.eventMeetUrlLabel) as HTMLInputElement;
    expect((title as HTMLInputElement).value).toBe("");
    expect(link.value).toMatch(/\/meet\/meetings\//);
    expect(link.value).not.toMatch(/\/guest/);
    expect(reserveRoom).toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: meetLabels.createChannelButton }).hasAttribute("disabled"),
    ).toBe(true);

    resolveReserve?.({ reserved: true, active: false });
    await waitFor(() => expect(link.value).toMatch(/\/meet\/meetings\//));
  });

  it("disables Create when the title is empty or whitespace-only", async () => {
    const { createEvent } = renderDialog();

    const title = screen.getByLabelText(defaultCalendarLabels.eventTitleLabel);
    const create = await screen.findByRole("button", { name: meetLabels.createChannelButton });
    expect((title as HTMLInputElement).value).toBe("");
    expect(title.getAttribute("placeholder")).toBe(defaultCalendarLabels.eventTitleLabel);
    expect(
      (screen.getByLabelText(defaultCalendarLabels.eventMeetUrlLabel) as HTMLInputElement).value,
    ).toMatch(/\/meet\/meetings\//);
    expect(create.hasAttribute("disabled")).toBe(true);

    fireEvent.click(create);
    expect(createEvent).not.toHaveBeenCalled();

    fireEvent.change(title, { target: { value: "   " } });
    expect(create.hasAttribute("disabled")).toBe(true);
    fireEvent.click(create);
    expect(createEvent).not.toHaveBeenCalled();
  });

  it("enables Create after a title is typed, including when Schedule is on", async () => {
    const { createEvent } = renderDialog();
    const createName = meetLabels.createChannelButton;

    fireEvent.click(screen.getByRole("switch", { name: meetLabels.scheduleMeeting }));
    expect(screen.getByRole("button", { name: createName }).hasAttribute("disabled")).toBe(true);

    fireEvent.change(screen.getByLabelText(defaultCalendarLabels.eventTitleLabel), {
      target: { value: "Standup" },
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: createName }).hasAttribute("disabled")).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: createName }));

    await waitFor(() => expect(createEvent).toHaveBeenCalledTimes(1));
    expect((createEvent.mock.calls[0]?.[0] as { title: string }).title).toBe("Standup");
  });

  it("places Schedule under title and Meet with All day CardRow chrome", () => {
    renderDialog();

    const title = screen.getByLabelText(defaultCalendarLabels.eventTitleLabel);
    const meet = screen.getByRole("heading", { name: defaultCalendarLabels.eventMeetSectionTitle });
    const scheduleSwitch = screen.getByRole("switch", { name: meetLabels.scheduleMeeting });
    const scheduleRow = scheduleSwitch.closest(".card__row");

    expect(title.compareDocumentPosition(meet) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      meet.compareDocumentPosition(scheduleSwitch) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(scheduleRow?.querySelector(".card__row-title")?.textContent).toBe(
      meetLabels.scheduleMeeting,
    );
    expect(scheduleRow?.closest(".calendar-event-dialog__card")).toBeTruthy();
    expect(screen.queryByText(defaultCalendarLabels.eventWhenSectionTitle)).toBeNull();
    expect(
      (screen.getByLabelText(defaultCalendarLabels.eventMeetUrlLabel) as HTMLInputElement).value,
    ).toMatch(/\/meet\/meetings\//);

    fireEvent.click(scheduleSwitch);
    const when = screen.getByText(defaultCalendarLabels.eventWhenSectionTitle);
    const allDay = screen.getByRole("switch", { name: defaultCalendarLabels.eventAllDayLabel });
    const allDayRow = allDay.closest(".card__row");
    expect(
      scheduleSwitch.compareDocumentPosition(when) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(allDayRow?.classList.contains("card__row")).toBe(true);
    expect(allDayRow?.querySelector(".card__row-title")?.textContent).toBe(
      defaultCalendarLabels.eventAllDayLabel,
    );
    expect(allDayRow?.closest(".calendar-event-dialog__card")).toBeTruthy();
  });

  it("hides When until Schedule is on and shows the calendar picker", () => {
    renderDialog();

    expect(screen.getByRole("heading", { name: meetLabels.newMeeting })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Calendar: Personal/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: defaultCalendarLabels.eventMeetAdd })).toBeNull();
    expect(screen.queryByText(defaultCalendarLabels.eventWhenSectionTitle)).toBeNull();
    expect(screen.queryByText(defaultCalendarLabels.eventAttendeesLabel)).toBeNull();

    fireEvent.click(screen.getByRole("switch", { name: meetLabels.scheduleMeeting }));
    expect(screen.getByText(defaultCalendarLabels.eventWhenSectionTitle)).toBeTruthy();
    expect(screen.getByText(defaultCalendarLabels.eventAttendeesLabel)).toBeTruthy();
    expect(screen.getByText(defaultCalendarLabels.eventNotesLabel)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Calendar: Personal/i })).toBeTruthy();
  });

  it("does not prompt on Create when Schedule is on and an email invitee is present", async () => {
    const { createEvent, createChannel } = renderDialog({
      invitees: [{ username: "wouter", email: "wouter@woutervroege.nl", name: "Wouter" }],
    });
    fireEvent.click(screen.getByRole("switch", { name: meetLabels.scheduleMeeting }));
    fireEvent.change(screen.getByLabelText(defaultCalendarLabels.eventTitleLabel), {
      target: { value: "Standup" },
    });
    const add = screen.getByLabelText(defaultCalendarLabels.eventAttendeesAdd);
    fireEvent.change(add, { target: { value: "guest@elsewhere.test" } });
    fireEvent.keyDown(add, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: meetLabels.createChannelButton }));
    expect(screen.queryByText(defaultCalendarLabels.eventMeetChannelEmailTitle)).toBeNull();
    await waitFor(() => expect(createEvent).toHaveBeenCalledTimes(1));
    expect(createChannel).toHaveBeenCalledWith({ name: "Standup", kind: "meeting" });
    const draft = createEvent.mock.calls[0]?.[0] as {
      links?: Record<string, { href?: string }>;
      attendees?: { email: string }[];
    };
    expect(draft.links?.[CALENDAR_MEET_LINK_KEY]?.href).toMatch(/\/meet\/meetings\//);
    expect(draft.attendees?.some((row) => row.email === "guest@elsewhere.test")).toBe(true);
  });

  it("creates on the calendar selected in the picker", async () => {
    const { createEvent } = renderDialog();

    const trigger = screen.getByRole("button", { name: /Calendar: Personal/i });
    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "Work" }));
    expect(screen.getByRole("button", { name: /Calendar: Work/i })).toBeTruthy();

    fireEvent.change(screen.getByLabelText(defaultCalendarLabels.eventTitleLabel), {
      target: { value: "Standup" },
    });
    fireEvent.click(screen.getByRole("button", { name: meetLabels.createChannelButton }));

    await waitFor(() => expect(createEvent).toHaveBeenCalledTimes(1));
    expect((createEvent.mock.calls[0]?.[0] as { calendarId: string }).calendarId).toBe("work");
  });

  it("edits a meeting as the calendar-event variant and saves title + event", async () => {
    const event = {
      "@type": "Event" as const,
      id: "cal-standup",
      uid: "urn:uuid:cal-standup",
      calendarIds: { default: true },
      title: "Standup",
      start: "2026-09-07T15:00:00",
      duration: "PT30M",
      timeZone: "UTC",
      links: {
        [CALENDAR_MEET_LINK_KEY]: {
          "@type": "Link" as const,
          href: `${ORIGIN}/meet/meetings/standup`,
          rel: "describedby",
        },
      },
    };
    const channel = {
      id: "chat-standup",
      name: "Standup",
      kind: "meeting" as const,
      scope: "personal" as const,
      guestRoomCode: null,
    };
    const patchEvent = vi.fn().mockResolvedValue({ ...event, title: "Standup weekly" });
    const patchChannel = vi.fn().mockResolvedValue({ ...channel, name: "Standup weekly" });
    const onUpdated = vi.fn();
    const { meetOperations } = renderDialog({
      mode: "edit",
      event,
      channel,
      patchEvent,
      patchChannel,
      onUpdated,
    });

    expect(screen.getByRole("heading", { name: meetLabels.editMeeting })).toBeTruthy();
    expect(screen.getByRole("button", { name: meetLabels.saveChannelButton })).toBeTruthy();
    expect(screen.queryByRole("switch", { name: meetLabels.scheduleMeeting })).toBeNull();
    expect(screen.getByText(defaultCalendarLabels.eventWhenSectionTitle)).toBeTruthy();
    expect(screen.getByText(defaultCalendarLabels.eventAttendeesLabel)).toBeTruthy();
    expect(screen.getByText(defaultCalendarLabels.eventNotesLabel)).toBeTruthy();
    expect(meetOperations.reserveRoom).not.toHaveBeenCalled();

    const trigger = screen.getByRole("button", { name: /Calendar: Personal/i });
    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "Work" }));
    expect(screen.getByRole("button", { name: /Calendar: Work/i })).toBeTruthy();

    fireEvent.change(screen.getByLabelText(defaultCalendarLabels.eventTitleLabel), {
      target: { value: "Standup weekly" },
    });
    fireEvent.click(screen.getByRole("button", { name: meetLabels.saveChannelButton }));

    await waitFor(() =>
      expect(patchChannel).toHaveBeenCalledWith("chat-standup", {
        name: "Standup weekly",
      }),
    );
    await waitFor(() => expect(patchEvent).toHaveBeenCalledTimes(1));
    expect(patchEvent.mock.calls[0]?.[0]).toBe("cal-standup");
    expect((patchEvent.mock.calls[0]?.[1] as { title?: string; calendarId?: string }).title).toBe(
      "Standup weekly",
    );
    expect((patchEvent.mock.calls[0]?.[1] as { calendarId?: string }).calendarId).toBe("work");
    expect(onUpdated).toHaveBeenCalled();
  });

  it("shows the calendar picker when editing a leftover upcoming meeting", () => {
    renderDialog({
      mode: "edit",
      leftover: { title: "Sprint planning", href: `${ORIGIN}/meet/meetings/sprint` },
    });

    expect(screen.getByRole("heading", { name: meetLabels.editMeeting })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Calendar: Personal/i })).toBeTruthy();
    expect(screen.queryByRole("switch", { name: meetLabels.scheduleMeeting })).toBeNull();
    expect(screen.getByText(defaultCalendarLabels.eventWhenSectionTitle)).toBeTruthy();
  });
});
