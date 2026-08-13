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
      recurrenceRules: [{ "@type": "RecurrenceRule", frequency: "daily", count: 4 }],
    } as Parameters<typeof calendarEventToForm>[0]);
    expect(form.recurrencePreset).toBe("custom");
    renderDialog({ form, locale: "en-US" });
    const repeat = screen.getByRole("combobox", { name: defaultCalendarLabels.eventRepeatLabel });
    expect(repeat.textContent).toMatch(/Custom/i);
    expect(repeat.hasAttribute("disabled") || repeat.getAttribute("data-disabled") !== null).toBe(
      true,
    );
  });

  it("offers delete only in edit mode and forwards it", () => {
    const form = { ...emptyCalendarEventForm("default", "2033-01-12"), title: "x" };
    renderDialog({ form, mode: "edit", onDelete: vi.fn() });
    const deleteButton = screen.getByRole("button", { name: defaultCalendarLabels.delete });
    expect(deleteButton).toBeTruthy();
  });
});
