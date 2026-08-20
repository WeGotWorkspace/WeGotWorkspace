import type React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarEventDialog } from "@/calendar-core/src/calendar-event-dialog";
import { TooltipProvider } from "@/ui/tooltip";
import {
  calendarEventToForm,
  emptyCalendarEventForm,
} from "@/calendar-core/src/calendar-editor-model";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import { createCalendarAppBootstrap } from "@/lib/api/mock/calendar-bootstrap";

const bootstrap = createCalendarAppBootstrap();

function renderDialog(overrides: Partial<React.ComponentProps<typeof CalendarEventDialog>> = {}) {
  const onSave = vi.fn();
  const onClose = vi.fn();
  const onChange = vi.fn();
  const onDelete = vi.fn();

  render(
    <TooltipProvider delayDuration={0}>
      <CalendarEventDialog
        open
        mode="create"
        form={emptyCalendarEventForm("default", "2033-01-12")}
        calendars={bootstrap.data.calendars}
        labels={defaultCalendarLabels}
        locale="en-US"
        onChange={onChange}
        onClose={onClose}
        onSave={onSave}
        {...overrides}
      />
    </TooltipProvider>,
  );

  return { onSave, onClose, onChange, onDelete };
}

describe("CalendarEventDialog", () => {
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

  it("disables save until the form is valid", () => {
    renderDialog();
    const save = screen.getByRole("button", { name: defaultCalendarLabels.save });
    expect(save.hasAttribute("disabled")).toBe(true);
  });

  it("propagates title edits and submits a valid form", () => {
    const form = { ...emptyCalendarEventForm("default", "2033-01-12"), title: "Lunch" };
    const { onSave, onChange } = renderDialog({ form });

    const titleInput = screen.getByDisplayValue("Lunch");
    fireEvent.change(titleInput, { target: { value: "Team lunch" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ title: "Team lunch" }));

    fireEvent.click(screen.getByRole("button", { name: defaultCalendarLabels.save }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("keeps the calendar picker as a color swatch trigger when closed", () => {
    renderDialog();
    const trigger = screen.getByRole("button", { name: /Calendar: Personal/i });
    expect(trigger.querySelector(".calendar-color-swatch-trigger__dot")).toBeTruthy();
    expect(trigger.querySelector(".calendar-color-swatch-trigger__chevron")).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /Personal/i })).toBeNull();
  });

  it("places location under the title and exposes notes", () => {
    const form = {
      ...emptyCalendarEventForm("default", "2033-01-12"),
      title: "Lunch",
      location: "Cafe",
      description: "Bring laptop",
    };
    const { onChange } = renderDialog({ form });

    expect(screen.getByDisplayValue("Cafe")).toBeTruthy();
    const notes = screen.getByDisplayValue("Bring laptop");
    fireEvent.change(notes, { target: { value: "Bring slides" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ description: "Bring slides" }));
  });

  it("hides time inputs for all-day events and shows locale date triggers", () => {
    const form = {
      ...calendarEventToForm({
        "@type": "Event",
        id: "offsite",
        uid: "urn:uuid:offsite",
        calendarIds: { default: true },
        title: "Offsite",
        start: "2033-01-17T00:00:00",
        duration: "P2D",
        showWithoutTime: true,
      } as Parameters<typeof calendarEventToForm>[0]),
    };
    renderDialog({ form, mode: "edit", onDelete: vi.fn(), locale: "en-US" });
    expect(document.querySelectorAll('input[type="time"]')).toHaveLength(0);
    expect(screen.getAllByRole("button", { name: /Jan/i }).length).toBeGreaterThanOrEqual(2);
    expect(
      screen.queryByRole("combobox", { name: defaultCalendarLabels.eventTimeZoneLabel }),
    ).toBeNull();
  });

  it("shows a timezone select for timed events and propagates changes", () => {
    const form = {
      ...emptyCalendarEventForm("default", "2033-01-12"),
      title: "Lunch",
      timeZone: "Europe/Amsterdam",
    };
    const { onChange } = renderDialog({ form, locale: "en-US" });
    const zone = screen.getByRole("combobox", { name: defaultCalendarLabels.eventTimeZoneLabel });
    expect(zone.textContent).toMatch(/Amsterdam|Europe\/Amsterdam/i);
    fireEvent.click(zone);
    const utc = screen.getByRole("option", { name: /^UTC$/i });
    fireEvent.click(utc);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ timeZone: "UTC" }));
  });

  it("shows Custom for unmatched recurrence and disables the repeat control", () => {
    const form = calendarEventToForm({
      "@type": "Event",
      id: "custom",
      uid: "urn:uuid:custom",
      calendarIds: { default: true },
      title: "Odd series",
      start: "2033-01-12T10:00:00",
      duration: "PT1H",
      recurrenceRules: [
        {
          "@type": "RecurrenceRule",
          frequency: "weekly",
          byDay: [
            { "@type": "NDay", day: "mo" },
            { "@type": "NDay", day: "we" },
          ],
        },
      ],
    } as Parameters<typeof calendarEventToForm>[0]);
    expect(form.recurrencePreset).toBe("custom");
    renderDialog({ form, locale: "en-US" });
    const repeat = screen.getByRole("combobox", { name: defaultCalendarLabels.eventRepeatLabel });
    expect(repeat.textContent).toMatch(/Custom/i);
    expect(repeat.hasAttribute("disabled") || repeat.getAttribute("data-disabled") !== null).toBe(
      true,
    );
    expect(
      screen.queryByRole("combobox", { name: defaultCalendarLabels.eventRecurrenceEndsLabel }),
    ).toBeNull();
  });

  it("groups schedule, recurrence, invitees, and alarms into cards in order", () => {
    const form = {
      ...emptyCalendarEventForm("default", "2033-01-12"),
      title: "Standup",
      recurrencePreset: "daily" as const,
    };
    renderDialog({ form, locale: "en-US" });
    const whenTitle = screen.getByRole("heading", {
      name: defaultCalendarLabels.eventWhenSectionTitle,
    });
    const repeatTitle = screen.getByRole("heading", {
      name: defaultCalendarLabels.eventRepeatLabel,
    });
    const inviteesTitle = screen.getByRole("heading", {
      name: defaultCalendarLabels.eventAttendeesLabel,
    });
    const alarmsTitle = screen.getByRole("heading", {
      name: defaultCalendarLabels.eventAlarmsLabel,
    });
    const whenCard = whenTitle.closest(".card");
    const repeatCard = repeatTitle.closest(".card");
    const inviteesCard = inviteesTitle.closest(".card");
    const alarmsCard = alarmsTitle.closest(".card");
    expect(whenCard).not.toBeNull();
    expect(repeatCard).not.toBeNull();
    expect(inviteesCard).not.toBeNull();
    expect(inviteesCard!.classList.contains("calendar-invitees-card")).toBe(true);
    expect(alarmsCard).not.toBeNull();
    expect(whenCard!.querySelector(".card__panel")).toBeNull();
    expect(repeatCard!.querySelector(".card__panel")).toBeNull();
    expect(whenCard!.querySelector(".card__row")).not.toBeNull();
    expect(
      whenCard!.querySelector(`[aria-label="${defaultCalendarLabels.eventAllDayLabel}"]`),
    ).not.toBeNull();
    expect(
      whenCard!.querySelector(`[aria-label="${defaultCalendarLabels.eventTimeZoneLabel}"]`),
    ).not.toBeNull();
    expect(
      whenCard!.querySelector(`[aria-label="${defaultCalendarLabels.eventShowAs}"]`),
    ).toBeNull();
    expect(
      repeatCard!.querySelector(`[aria-label="${defaultCalendarLabels.eventRepeatLabel}"]`),
    ).not.toBeNull();
    expect(
      repeatCard!.querySelector(`[aria-label="${defaultCalendarLabels.eventRecurrenceEndsLabel}"]`),
    ).not.toBeNull();

    const cards = document.querySelectorAll(
      ".calendar-event-dialog__fields > .calendar-event-dialog__card",
    );
    expect([...cards].map((card) => card.querySelector(".card__title")?.textContent)).toEqual([
      defaultCalendarLabels.eventWhenSectionTitle,
      defaultCalendarLabels.eventRepeatLabel,
      defaultCalendarLabels.eventAttendeesLabel,
      defaultCalendarLabels.eventAlarmsLabel,
    ]);
    const fieldRows = document.querySelectorAll(
      ".calendar-event-dialog__fields > .field-label-row",
    );
    expect(
      [...fieldRows].map((row) => row.querySelector(".field-label-row__label")?.textContent),
    ).toEqual([
      defaultCalendarLabels.eventLocationLabel,
      defaultCalendarLabels.eventShowAs,
      defaultCalendarLabels.eventNotesLabel,
    ]);
  });

  it("shows Ends controls for editable repeating presets", () => {
    const form = {
      ...emptyCalendarEventForm("default", "2033-01-12"),
      title: "Standup",
      recurrencePreset: "daily" as const,
    };
    const { onChange } = renderDialog({ form, locale: "en-US" });
    const ends = screen.getByRole("combobox", {
      name: defaultCalendarLabels.eventRecurrenceEndsLabel,
    });
    expect(ends.textContent).toMatch(/Never/i);
    const untilDate = screen.getByRole("button", {
      name: new RegExp(defaultCalendarLabels.eventRecurrenceEndsOnDate, "i"),
    });
    expect(untilDate.hasAttribute("disabled")).toBe(true);
    fireEvent.click(ends);
    fireEvent.click(screen.getByRole("option", { name: /After/i }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ recurrenceEnds: "count", recurrenceCount: 10 }),
    );
  });

  it("shows Show as as a plain field like Notes, Busy/Free only", () => {
    const form = { ...emptyCalendarEventForm("default", "2033-01-12"), title: "Lunch" };
    const { onChange } = renderDialog({ form, locale: "en-US" });
    expect(screen.queryByRole("heading", { name: defaultCalendarLabels.eventShowAs })).toBeNull();
    const showAs = screen.getByRole("combobox", { name: defaultCalendarLabels.eventShowAs });
    const showAsRow = showAs.closest(".field-label-row");
    const notesRow = screen
      .getByPlaceholderText(defaultCalendarLabels.eventNotesLabel)
      .closest(".field-label-row");
    expect(showAsRow).not.toBeNull();
    expect(showAs.closest(".card")).toBeNull();
    expect(showAsRow).not.toBe(notesRow);
    expect(showAs.textContent).toMatch(/Busy/i);
    fireEvent.click(showAs);
    expect(
      screen.getByRole("option", { name: defaultCalendarLabels.eventShowAsBusy }),
    ).toBeTruthy();
    expect(
      screen.getByRole("option", { name: defaultCalendarLabels.eventShowAsFree }),
    ).toBeTruthy();
    expect(screen.queryByRole("option", { name: /Tentative/i })).toBeNull();
    fireEvent.click(screen.getByRole("option", { name: defaultCalendarLabels.eventShowAsFree }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ freeBusyStatus: "free" }));
  });

  it("shows the alarms card, adds an alarm from the trailing None row, and forwards offset changes", () => {
    const form = { ...emptyCalendarEventForm("default", "2033-01-12"), title: "Lunch" };
    const { onChange } = renderDialog({ form, locale: "en-US" });
    expect(
      screen.getByRole("heading", { name: defaultCalendarLabels.eventAlarmsLabel }),
    ).toBeTruthy();
    expect(screen.queryByText(defaultCalendarLabels.eventAlarmsNone)).toBeNull();
    expect(screen.queryByRole("button", { name: defaultCalendarLabels.eventAlarmAdd })).toBeNull();
    expect(screen.getAllByText(defaultCalendarLabels.eventAlarmsLabel)).toHaveLength(1);
    expect(screen.getByText(`${defaultCalendarLabels.eventAlarmRow} 1`)).toBeTruthy();
    expect(
      screen
        .getByRole("heading", { name: defaultCalendarLabels.eventAlarmsLabel })
        .closest(".share-access-card"),
    ).not.toBeNull();

    const emptyOffset = screen.getByRole("combobox", {
      name: defaultCalendarLabels.eventAlarmOffset,
    });
    expect(emptyOffset.textContent).toMatch(/None/i);
    fireEvent.click(emptyOffset);
    fireEvent.click(screen.getByRole("option", { name: defaultCalendarLabels.eventAlarm15Min }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        alerts: [expect.objectContaining({ id: "alert1", action: "display", offset: "-PT15M" })],
      }),
    );

    const withAlarm = {
      ...form,
      alerts: [{ id: "alert1", action: "display" as const, offset: "-PT15M" }],
    };
    cleanup();
    const next = renderDialog({ form: withAlarm, locale: "en-US" });
    expect(screen.getAllByText(defaultCalendarLabels.eventAlarmsLabel)).toHaveLength(1);
    expect(screen.getByText(`${defaultCalendarLabels.eventAlarmRow} 1`)).toBeTruthy();
    expect(screen.getByText(`${defaultCalendarLabels.eventAlarmRow} 2`)).toBeTruthy();
    expect(screen.queryByRole("button", { name: defaultCalendarLabels.eventAlarmAdd })).toBeNull();
    const offsets = screen.getAllByRole("combobox", {
      name: defaultCalendarLabels.eventAlarmOffset,
    });
    expect(offsets).toHaveLength(2);
    expect(offsets[0]?.textContent).toMatch(/15 minutes/i);
    expect(offsets[1]?.textContent).toMatch(/None/i);
    expect(screen.queryByRole("option", { name: /Email/i })).toBeNull();
    expect(screen.queryByRole("option", { name: /Notification/i })).toBeNull();
    fireEvent.click(offsets[0]!);
    fireEvent.click(screen.getByRole("option", { name: defaultCalendarLabels.eventAlarm1Hour }));
    expect(next.onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        alerts: [expect.objectContaining({ id: "alert1", action: "display", offset: "-PT1H" })],
      }),
    );

    fireEvent.click(offsets[0]!);
    fireEvent.click(screen.getByRole("option", { name: defaultCalendarLabels.eventAlarmNone }));
    expect(next.onChange).toHaveBeenCalledWith(expect.objectContaining({ alerts: [] }));
  });

  it("shows leftover email alarms without an action menu and keeps offset editable", () => {
    const form = {
      ...emptyCalendarEventForm("default", "2033-01-12"),
      title: "Lunch",
      alerts: [{ id: "alert1", action: "display" as const, offset: "-PT15M" }],
    };
    const { onChange } = renderDialog({ form, locale: "en-US" });
    const offset = screen.getAllByRole("combobox", {
      name: defaultCalendarLabels.eventAlarmOffset,
    })[0];
    expect(offset?.textContent).toMatch(/15 minutes/i);
    expect(screen.queryByRole("combobox", { name: /Action/i })).toBeNull();
    expect(screen.queryByRole("option", { name: /Email/i })).toBeNull();
    fireEvent.click(offset!);
    fireEvent.click(screen.getByRole("option", { name: defaultCalendarLabels.eventAlarm30Min }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        alerts: [expect.objectContaining({ id: "alert1", action: "display", offset: "-PT30M" })],
      }),
    );
  });

  it("shows unmatched leftover offsets as a disabled option and omits Custom", () => {
    const form = {
      ...emptyCalendarEventForm("default", "2033-01-12"),
      title: "Lunch",
      alerts: [{ id: "alert1", action: "display" as const, offset: "-PT45M" }],
    };
    const { onChange } = renderDialog({ form, locale: "en-US" });
    const offset = screen.getAllByRole("combobox", {
      name: defaultCalendarLabels.eventAlarmOffset,
    })[0];
    expect(offset?.textContent).toMatch(/45 minutes before/i);
    fireEvent.click(offset!);
    expect(screen.queryByRole("option", { name: /^Custom$/i })).toBeNull();
    const foreign = screen.getByRole("option", { name: /45 minutes before/i });
    expect(foreign.hasAttribute("disabled") || foreign.getAttribute("data-disabled") !== null).toBe(
      true,
    );
    fireEvent.click(screen.getByRole("option", { name: defaultCalendarLabels.eventAlarmNone }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ alerts: [] }));
  });

  it("adds an external invitee from the people input", () => {
    const form = { ...emptyCalendarEventForm("default", "2033-01-12"), title: "Lunch" };
    const { onChange } = renderDialog({ form, canSubmitEmail: true });
    const add = screen.getByLabelText(defaultCalendarLabels.eventAttendeesAdd);
    fireEvent.change(add, { target: { value: "guest@elsewhere.test" } });
    fireEvent.keyDown(add, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        attendees: [
          expect.objectContaining({
            email: "guest@elsewhere.test",
            participationStatus: "needs-action",
            role: "required",
          }),
        ],
      }),
    );
  });

  it("adds teammate wouter once and shows one invitee row", () => {
    const invitees = [{ username: "wouter", email: "wouter@woutervroege.nl", name: "Wouter" }];
    const form = { ...emptyCalendarEventForm("default", "2033-01-12"), title: "Lunch" };
    const { onChange } = renderDialog({
      form,
      invitees,
      sessionEmail: "admin@localhost",
    });
    fireEvent.change(screen.getByLabelText(defaultCalendarLabels.eventAttendeesAdd), {
      target: { value: "wou" },
    });
    fireEvent.mouseDown(screen.getByRole("option", { name: /Wouter/i }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        attendees: [
          expect.objectContaining({
            email: "wouter@woutervroege.nl",
            name: "Wouter",
            role: "required",
          }),
        ],
      }),
    );

    cleanup();
    renderDialog({
      form: {
        ...form,
        attendees: [
          {
            email: "wouter",
            name: "Wouter",
            participationStatus: "needs-action",
            role: "required",
          },
          {
            email: "wouter@woutervroege.nl",
            name: "Wouter",
            participationStatus: "needs-action",
            role: "required",
          },
        ],
      },
      invitees,
      sessionEmail: "admin@localhost",
    });
    expect(screen.getAllByText("Wouter")).toHaveLength(1);
    const removeButtons = screen.getAllByRole("button", {
      name: defaultCalendarLabels.eventAttendeesRemove,
    });
    expect(removeButtons.filter((button) => !button.hasAttribute("disabled"))).toHaveLength(1);
  });

  it("adds a teammate from autocomplete using username when email is empty", () => {
    const form = { ...emptyCalendarEventForm("default", "2033-01-12"), title: "Lunch" };
    const { onChange } = renderDialog({
      form,
      invitees: [{ username: "wouter", email: "", name: "Wouter" }],
      sessionEmail: "admin@localhost",
    });
    fireEvent.change(screen.getByLabelText(defaultCalendarLabels.eventAttendeesAdd), {
      target: { value: "wou" },
    });
    fireEvent.mouseDown(screen.getByRole("option", { name: /Wouter/i }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        attendees: [
          expect.objectContaining({
            email: "wouter",
            name: "Wouter",
            role: "required",
          }),
        ],
      }),
    );
  });

  it("keeps the invitee name visible beside a status avatar and delete control", () => {
    const form = {
      ...emptyCalendarEventForm("default", "2033-01-12"),
      title: "Lunch",
      attendees: [
        {
          email: "carol@example.test",
          name: "Carol",
          participationStatus: "needs-action" as const,
          role: "required" as const,
        },
      ],
    };
    renderDialog({ form });
    const name = screen.getByText("Carol");
    const row = name.closest(".card__row");
    expect(row).not.toBeNull();
    expect(name.classList.contains("card__row-title")).toBe(true);
    expect(row!.querySelector(".calendar-invitees-rsvp-tag--accepted")).toBeNull();
    expect(screen.getByLabelText(defaultCalendarLabels.eventAttendeesRsvpNeedsAction)).toBeTruthy();
    expect(row!.querySelector(".calendar-invitees-status-mark svg")).toBeTruthy();
    expect(row!.querySelector(".calendar-invitees-status-mark")?.textContent).toBe("");
    expect(row!.querySelector(".tag")).toBeNull();
    expect(screen.queryByRole("combobox", { name: /Required|Optional/i })).toBeNull();
    expect(
      screen.getByRole("button", { name: defaultCalendarLabels.eventAttendeesRemove }),
    ).toBeTruthy();
    expect(name.closest(".calendar-invitees-card")).not.toBeNull();
  });

  it("can remove an invitee without a role picker", () => {
    const form = {
      ...emptyCalendarEventForm("default", "2033-01-12"),
      title: "Lunch",
      attendees: [
        {
          email: "carol@example.test",
          name: "Carol",
          participationStatus: "accepted" as const,
          role: "required" as const,
        },
      ],
    };
    const { onChange } = renderDialog({ form });
    expect(
      screen.getByRole("heading", { name: defaultCalendarLabels.eventAttendeesLabel }),
    ).toBeTruthy();
    expect(screen.getByText("Carol")).toBeTruthy();
    expect(screen.getByLabelText(defaultCalendarLabels.eventAttendeesRsvpAccepted)).toBeTruthy();
    expect(document.querySelector(".calendar-invitees-card .tag")).toBeNull();
    expect(screen.queryByRole("combobox", { name: /Required|Optional/i })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: defaultCalendarLabels.eventAttendeesRemove }),
    );
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ attendees: [] }));
  });

  it("shows RSVP on the avatar without the username", () => {
    const form = {
      ...emptyCalendarEventForm("default", "2033-01-12"),
      title: "Lunch",
      attendees: [
        {
          email: "wouter@woutervroege.nl",
          name: "Wouter",
          participationStatus: "tentative" as const,
          role: "required" as const,
        },
        {
          email: "guest@elsewhere.test",
          name: "Guest",
          participationStatus: "needs-action" as const,
          role: "required" as const,
        },
      ],
    };
    renderDialog({
      form,
      invitees: [{ username: "wouter", email: "wouter@woutervroege.nl", name: "Wouter" }],
    });
    expect(screen.getByText("Wouter")).toBeTruthy();
    expect(screen.getByLabelText(defaultCalendarLabels.eventAttendeesRsvpTentative)).toBeTruthy();
    expect(screen.queryByText(/wouter ·/i)).toBeNull();
    expect(document.querySelector(".calendar-invitees-rsvp-tag--tentative")).toBeTruthy();
    expect(screen.queryByLabelText(defaultCalendarLabels.eventAttendeesRsvpAccepted)).toBeNull();
    expect(screen.getByText("Guest")).toBeTruthy();
    expect(screen.getByLabelText(defaultCalendarLabels.eventAttendeesRsvpNeedsAction)).toBeTruthy();
    expect(document.querySelector(".calendar-invitees-rsvp-tag--accepted")).toBeNull();
    expect(document.querySelectorAll(".calendar-invitees-card .tag")).toHaveLength(0);
  });

  it("lists the organizer with a disabled remove control and no status chip", () => {
    const form = {
      ...emptyCalendarEventForm("default", "2033-01-12"),
      title: "Lunch",
      attendees: [
        {
          email: "admin@localhost",
          name: "Admin",
          participationStatus: "accepted" as const,
          isOrganizer: true,
        },
        {
          email: "wouter",
          name: "Wouter",
          participationStatus: "needs-action" as const,
        },
      ],
    };
    renderDialog({ form, sessionEmail: "admin@localhost" });
    expect(screen.getByText("Admin")).toBeTruthy();
    expect(screen.getByLabelText(defaultCalendarLabels.eventAttendeesOrganizer)).toBeTruthy();
    expect(screen.getByText("Wouter")).toBeTruthy();
    expect(screen.getByLabelText(defaultCalendarLabels.eventAttendeesRsvpNeedsAction)).toBeTruthy();
    expect(screen.queryByLabelText(defaultCalendarLabels.eventAttendeesRsvpAccepted)).toBeNull();
    const removeButtons = screen.getAllByRole("button", {
      name: defaultCalendarLabels.eventAttendeesRemove,
    });
    expect(removeButtons).toHaveLength(2);
    expect(removeButtons[0].hasAttribute("disabled")).toBe(true);
    expect(removeButtons[1].hasAttribute("disabled")).toBe(false);
    expect(screen.queryByRole("combobox", { name: /Admin:|Required|Optional/i })).toBeNull();
  });

  it("shows the session organizer on a new event with no other invitees", () => {
    renderDialog({
      form: { ...emptyCalendarEventForm("default", "2033-01-12"), title: "Lunch" },
      sessionEmail: "admin@localhost",
      invitees: [{ username: "admin", email: "admin@localhost", name: "Admin" }],
    });
    expect(screen.getByText("Admin")).toBeTruthy();
    expect(screen.getByLabelText(defaultCalendarLabels.eventAttendeesOrganizer)).toBeTruthy();
    expect(screen.queryByLabelText(defaultCalendarLabels.eventAttendeesRsvpNeedsAction)).toBeNull();
    expect(
      screen.getByRole("button", { name: defaultCalendarLabels.eventAttendeesRemove }),
    ).toHaveProperty("disabled", true);
  });

  it("states that email delivery is unavailable when canSubmitEmail is false", () => {
    renderDialog({
      form: { ...emptyCalendarEventForm("default", "2033-01-12"), title: "Lunch" },
      canSubmitEmail: false,
    });
    expect(screen.getByText(defaultCalendarLabels.eventAttendeesEmailUnavailable)).toBeTruthy();
  });

  it("offers delete only in edit mode and forwards it", () => {
    const form = { ...emptyCalendarEventForm("default", "2033-01-12"), title: "x" };
    renderDialog({ form, mode: "edit", onDelete: vi.fn() });
    const deleteButton = screen.getByRole("button", { name: defaultCalendarLabels.delete });
    expect(deleteButton).toBeTruthy();
  });

  it("locks event fields for an invitee but keeps calendar, RSVP dropdown, and save", () => {
    const form = {
      ...emptyCalendarEventForm("default", "2033-01-12"),
      title: "Standup",
      location: "Room A",
      description: "Bring notes",
      attendees: [
        {
          email: "bob@example.test",
          name: "Bob",
          participationStatus: "accepted" as const,
          isOrganizer: true,
        },
        {
          email: "carol@example.test",
          name: "Carol",
          participationStatus: "needs-action" as const,
          role: "required" as const,
        },
      ],
      alerts: [{ id: "alert1", action: "display" as const, offset: "-PT15M" }],
    };
    renderDialog({
      form,
      mode: "edit",
      sessionEmail: "carol@example.test",
      onDelete: vi.fn(),
      onRsvp: vi.fn(),
    });

    expect(screen.getByDisplayValue("Standup")).toHaveProperty("disabled", true);
    expect(screen.getByDisplayValue("Room A")).toHaveProperty("disabled", true);
    expect(screen.getByDisplayValue("Bring notes")).toHaveProperty("disabled", true);
    expect(
      screen.getByRole("button", { name: /Calendar: Personal/i }).hasAttribute("disabled"),
    ).toBe(false);
    const allDay = screen.getByLabelText(defaultCalendarLabels.eventAllDayLabel);
    expect(allDay.hasAttribute("disabled") || allDay.getAttribute("data-disabled") !== null).toBe(
      true,
    );
    for (const name of [
      defaultCalendarLabels.eventTimeZoneLabel,
      defaultCalendarLabels.eventRepeatLabel,
      defaultCalendarLabels.eventShowAs,
      defaultCalendarLabels.eventAlarmOffset,
    ]) {
      const control = screen.getByRole("combobox", { name });
      expect(
        control.hasAttribute("disabled") || control.getAttribute("data-disabled") !== null,
      ).toBe(true);
    }
    expect(screen.queryByLabelText(defaultCalendarLabels.eventAttendeesAdd)).toBeNull();
    expect(
      screen.queryByRole("button", { name: defaultCalendarLabels.eventAttendeesRemove }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: defaultCalendarLabels.eventAlarmAdd })).toBeNull();
    expect(screen.getByRole("button", { name: defaultCalendarLabels.save })).toBeTruthy();
    expect(screen.getByRole("button", { name: defaultCalendarLabels.cancel })).toBeTruthy();
    expect(screen.queryByRole("button", { name: defaultCalendarLabels.delete })).toBeNull();
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: defaultCalendarLabels.rsvpLabel })).toBeTruthy();
    expect(screen.queryByRole("button", { name: defaultCalendarLabels.rsvpAccept })).toBeNull();
    expect(screen.queryByRole("button", { name: defaultCalendarLabels.rsvpMaybe })).toBeNull();
    expect(screen.queryByRole("button", { name: defaultCalendarLabels.rsvpDecline })).toBeNull();
    expect(screen.getByRole("button", { name: defaultCalendarLabels.save })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("shows the current PARTSTAT and calendar when the invitee dialog opens", () => {
    const form = {
      ...emptyCalendarEventForm("work", "2033-01-12"),
      title: "Standup",
      attendees: [
        {
          email: "bob@example.test",
          name: "Bob",
          participationStatus: "accepted" as const,
          isOrganizer: true,
        },
        {
          email: "carol@example.test",
          name: "Carol",
          participationStatus: "accepted" as const,
          role: "required" as const,
        },
      ],
    };
    renderDialog({
      form,
      mode: "edit",
      sessionEmail: "carol@example.test",
      onRsvp: vi.fn(),
    });

    const rsvp = screen.getByRole("combobox", { name: defaultCalendarLabels.rsvpLabel });
    expect(rsvp.className).toContain("calendar-rsvp-select--accept");
    expect(rsvp.className).toContain("calendar-rsvp-select--selected");
    expect(rsvp.querySelector("svg")).toBeTruthy();
    expect(rsvp.textContent).toMatch(/Accept/i);
    expect(screen.getByRole("button", { name: /Calendar: Work/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: defaultCalendarLabels.cancel })).toBeTruthy();
    expect(screen.getByRole("button", { name: defaultCalendarLabels.save })).toBeTruthy();
    expect(screen.queryByRole("button", { name: defaultCalendarLabels.delete })).toBeNull();
  });

  it("persists invitee calendar and RSVP only after Save", () => {
    const form = {
      ...emptyCalendarEventForm("default", "2033-01-12"),
      title: "Standup",
      attendees: [
        {
          email: "bob@example.test",
          name: "Bob",
          participationStatus: "accepted" as const,
          isOrganizer: true,
        },
        {
          email: "carol@example.test",
          name: "Carol",
          participationStatus: "accepted" as const,
          role: "required" as const,
        },
      ],
    };
    const onRsvp = vi.fn();
    const { onChange, onSave } = renderDialog({
      form,
      mode: "edit",
      sessionEmail: "carol@example.test",
      onRsvp,
    });

    const calendarTrigger = screen.getByRole("button", { name: /Calendar: Personal/i });
    fireEvent.pointerDown(calendarTrigger);
    fireEvent.click(calendarTrigger);
    fireEvent.click(screen.getByRole("menuitem", { name: /Work/i }));
    expect(onChange).not.toHaveBeenCalled();
    expect(onRsvp).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Calendar: Work/i })).toBeTruthy();

    const rsvp = screen.getByRole("combobox", { name: defaultCalendarLabels.rsvpLabel });
    fireEvent.click(rsvp);
    fireEvent.click(screen.getByRole("option", { name: defaultCalendarLabels.rsvpMaybe }));
    expect(onRsvp).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();

    const maybe = screen.getByRole("combobox", { name: defaultCalendarLabels.rsvpLabel });
    expect(maybe.className).toContain("calendar-rsvp-select--maybe");
    expect(maybe.className).toContain("calendar-rsvp-select--selected");

    fireEvent.click(screen.getByRole("button", { name: defaultCalendarLabels.save }));
    expect(onRsvp).toHaveBeenCalledTimes(1);
    expect(onRsvp).toHaveBeenCalledWith("tentative", "work");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("reverts the Save-gated RSVP when persist fails", async () => {
    const form = {
      ...emptyCalendarEventForm("default", "2033-01-12"),
      title: "Standup",
      attendees: [
        {
          email: "bob@example.test",
          name: "Bob",
          participationStatus: "accepted" as const,
          isOrganizer: true,
        },
        {
          email: "carol@example.test",
          name: "Carol",
          participationStatus: "accepted" as const,
          role: "required" as const,
        },
      ],
    };
    const onRsvp = vi.fn().mockRejectedValue(new Error("Could not send RSVP"));
    renderDialog({
      form,
      mode: "edit",
      sessionEmail: "carol@example.test",
      onRsvp,
    });

    fireEvent.click(screen.getByRole("combobox", { name: defaultCalendarLabels.rsvpLabel }));
    fireEvent.click(screen.getByRole("option", { name: defaultCalendarLabels.rsvpDecline }));
    fireEvent.click(screen.getByRole("button", { name: defaultCalendarLabels.save }));

    await waitFor(() => {
      expect(onRsvp).toHaveBeenCalledWith("declined", "default");
    });
    const rsvp = screen.getByRole("combobox", { name: defaultCalendarLabels.rsvpLabel });
    expect(rsvp.className).toContain("calendar-rsvp-select--accept");
    expect(rsvp.className).not.toContain("calendar-rsvp-select--decline");
  });

  it("discards invitee RSVP and calendar edits on Cancel", () => {
    const form = {
      ...emptyCalendarEventForm("default", "2033-01-12"),
      title: "Standup",
      attendees: [
        {
          email: "bob@example.test",
          name: "Bob",
          participationStatus: "accepted" as const,
          isOrganizer: true,
        },
        {
          email: "carol@example.test",
          name: "Carol",
          participationStatus: "accepted" as const,
          role: "required" as const,
        },
      ],
    };
    const onRsvp = vi.fn();
    const { onClose, onChange, onSave } = renderDialog({
      form,
      mode: "edit",
      sessionEmail: "carol@example.test",
      onRsvp,
    });

    const calendarTrigger = screen.getByRole("button", { name: /Calendar: Personal/i });
    fireEvent.pointerDown(calendarTrigger);
    fireEvent.click(calendarTrigger);
    fireEvent.click(screen.getByRole("menuitem", { name: /Work/i }));
    fireEvent.click(screen.getByRole("combobox", { name: defaultCalendarLabels.rsvpLabel }));
    fireEvent.click(screen.getByRole("option", { name: defaultCalendarLabels.rsvpDecline }));
    fireEvent.click(screen.getByRole("button", { name: defaultCalendarLabels.cancel }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onRsvp).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps the organizer edit dialog writable with save and delete", () => {
    const form = {
      ...emptyCalendarEventForm("default", "2033-01-12"),
      title: "Standup",
      location: "Room A",
      attendees: [
        {
          email: "admin",
          name: "Admin",
          participationStatus: "accepted" as const,
          isOrganizer: true,
        },
        {
          email: "carol@example.test",
          name: "Carol",
          participationStatus: "needs-action" as const,
          role: "required" as const,
        },
      ],
    };
    const { onChange } = renderDialog({
      form,
      mode: "edit",
      sessionEmail: "admin@localhost",
      onDelete: vi.fn(),
      onRsvp: vi.fn(),
    });

    const title = screen.getByDisplayValue("Standup");
    expect(title).toHaveProperty("disabled", false);
    fireEvent.change(title, { target: { value: "Weekly standup" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ title: "Weekly standup" }));
    expect(screen.getByRole("button", { name: defaultCalendarLabels.save })).toBeTruthy();
    expect(screen.getByRole("button", { name: defaultCalendarLabels.delete })).toBeTruthy();
    expect(screen.getByRole("button", { name: defaultCalendarLabels.cancel })).toBeTruthy();
    expect(screen.queryByRole("button", { name: defaultCalendarLabels.rsvpAccept })).toBeNull();
    expect(screen.getByLabelText(defaultCalendarLabels.eventAttendeesAdd)).toBeTruthy();
    const removeButtons = screen.getAllByRole("button", {
      name: defaultCalendarLabels.eventAttendeesRemove,
    });
    expect(removeButtons).toHaveLength(2);
    expect(removeButtons[0].hasAttribute("disabled")).toBe(true);
    expect(removeButtons[1].hasAttribute("disabled")).toBe(false);
  });

  it("locks the dialog when the invitee identity is a username alias", () => {
    const form = {
      ...emptyCalendarEventForm("default", "2033-01-12"),
      title: "Standup",
      attendees: [
        {
          email: "bob@example.test",
          name: "Bob",
          participationStatus: "accepted" as const,
          isOrganizer: true,
        },
        {
          email: "wouter",
          name: "Wouter",
          participationStatus: "needs-action" as const,
          role: "required" as const,
        },
      ],
    };
    renderDialog({
      form,
      mode: "edit",
      sessionEmail: "wouter@woutervroege.nl",
      invitees: [{ username: "wouter", email: "wouter@woutervroege.nl", name: "Wouter" }],
      onDelete: vi.fn(),
      onRsvp: vi.fn(),
    });
    expect(screen.getByDisplayValue("Standup")).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: defaultCalendarLabels.save })).toBeTruthy();
    expect(screen.getByRole("button", { name: defaultCalendarLabels.cancel })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: defaultCalendarLabels.rsvpLabel })).toBeTruthy();
    expect(screen.queryByRole("button", { name: defaultCalendarLabels.rsvpAccept })).toBeNull();
  });
});
