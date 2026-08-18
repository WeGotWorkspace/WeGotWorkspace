import type React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarEventDialog } from "@/calendar-core/src/calendar-event-dialog";
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
    />,
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

  it("groups schedule, recurrence, show-as, and alarms into cards", () => {
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
    const showAsTitle = screen.getByRole("heading", {
      name: defaultCalendarLabels.eventShowAs,
    });
    const alarmsTitle = screen.getByRole("heading", {
      name: defaultCalendarLabels.eventAlarmsLabel,
    });
    const whenCard = whenTitle.closest(".card");
    const repeatCard = repeatTitle.closest(".card");
    const showAsCard = showAsTitle.closest(".card");
    const alarmsCard = alarmsTitle.closest(".card");
    expect(whenCard).not.toBeNull();
    expect(repeatCard).not.toBeNull();
    expect(showAsCard).not.toBeNull();
    expect(alarmsCard).not.toBeNull();
    expect(showAsCard).not.toBe(whenCard);
    expect(showAsCard).not.toBe(repeatCard);
    expect(showAsCard).not.toBe(alarmsCard);
    expect(whenCard!.querySelector(".card__panel")).toBeNull();
    expect(repeatCard!.querySelector(".card__panel")).toBeNull();
    expect(showAsCard!.querySelector(".card__panel")).toBeNull();
    expect(whenCard!.querySelector(".card__row")).not.toBeNull();
    expect(showAsCard!.querySelector(".card__row")).not.toBeNull();
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
      showAsCard!.querySelector(`[aria-label="${defaultCalendarLabels.eventShowAs}"]`),
    ).not.toBeNull();
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
      defaultCalendarLabels.eventShowAs,
      defaultCalendarLabels.eventAlarmsLabel,
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

  it("shows Show as as Busy/Free only and persists Free through onChange", () => {
    const form = { ...emptyCalendarEventForm("default", "2033-01-12"), title: "Lunch" };
    const { onChange } = renderDialog({ form, locale: "en-US" });
    const showAsTitle = screen.getByRole("heading", { name: defaultCalendarLabels.eventShowAs });
    const showAsCard = showAsTitle.closest(".card");
    const whenCard = screen
      .getByRole("heading", { name: defaultCalendarLabels.eventWhenSectionTitle })
      .closest(".card");
    expect(showAsCard).not.toBeNull();
    expect(showAsCard).not.toBe(whenCard);
    const showAs = screen.getByRole("combobox", { name: defaultCalendarLabels.eventShowAs });
    expect(showAsCard!.contains(showAs)).toBe(true);
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

  it("shows the alarms card, adds an alarm, and forwards offset changes", () => {
    const form = { ...emptyCalendarEventForm("default", "2033-01-12"), title: "Lunch" };
    const { onChange } = renderDialog({ form, locale: "en-US" });
    expect(
      screen.getByRole("heading", { name: defaultCalendarLabels.eventAlarmsLabel }),
    ).toBeTruthy();
    expect(screen.getByText(defaultCalendarLabels.eventAlarmsNone)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: defaultCalendarLabels.eventAlarmAdd }));
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
    const offset = screen.getByRole("combobox", { name: defaultCalendarLabels.eventAlarmsLabel });
    expect(offset.textContent).toMatch(/15 minutes/i);
    expect(screen.queryByRole("option", { name: /Email/i })).toBeNull();
    expect(screen.queryByRole("option", { name: /Notification/i })).toBeNull();
    fireEvent.click(offset);
    fireEvent.click(screen.getByRole("option", { name: defaultCalendarLabels.eventAlarm1Hour }));
    expect(next.onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        alerts: [expect.objectContaining({ id: "alert1", action: "display", offset: "-PT1H" })],
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: defaultCalendarLabels.eventAlarmRemove }));
    expect(next.onChange).toHaveBeenCalledWith(expect.objectContaining({ alerts: [] }));
  });

  it("shows leftover email alarms without an action menu and keeps offset editable", () => {
    const form = {
      ...emptyCalendarEventForm("default", "2033-01-12"),
      title: "Lunch",
      alerts: [{ id: "alert1", action: "display" as const, offset: "-PT15M" }],
    };
    const { onChange } = renderDialog({ form, locale: "en-US" });
    const offset = screen.getByRole("combobox", { name: defaultCalendarLabels.eventAlarmsLabel });
    expect(offset.textContent).toMatch(/15 minutes/i);
    expect(screen.queryByRole("combobox", { name: /Action/i })).toBeNull();
    expect(screen.queryByRole("option", { name: /Email/i })).toBeNull();
    fireEvent.click(offset);
    fireEvent.click(screen.getByRole("option", { name: defaultCalendarLabels.eventAlarm30Min }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        alerts: [expect.objectContaining({ id: "alert1", action: "display", offset: "-PT30M" })],
      }),
    );
  });

  it("offers delete only in edit mode and forwards it", () => {
    const form = { ...emptyCalendarEventForm("default", "2033-01-12"), title: "x" };
    renderDialog({ form, mode: "edit", onDelete: vi.fn() });
    const deleteButton = screen.getByRole("button", { name: defaultCalendarLabels.delete });
    expect(deleteButton).toBeTruthy();
  });
});
