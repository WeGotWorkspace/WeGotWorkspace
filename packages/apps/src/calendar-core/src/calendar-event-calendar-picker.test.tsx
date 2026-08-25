import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CalendarEventCalendarPicker,
  defaultPickerCalendarId,
} from "@/calendar-core/src/calendar-event-calendar-picker";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import { createCalendarAppBootstrap } from "@/lib/api/mock/calendar-bootstrap";

const calendars = createCalendarAppBootstrap().data.calendars;

afterEach(() => {
  cleanup();
});

describe("CalendarEventCalendarPicker", () => {
  it("defaults to the preferred writable calendar", () => {
    expect(defaultPickerCalendarId(calendars, "default")).toBe("default");
    expect(defaultPickerCalendarId(calendars, "missing")).toBe("default");
    expect(defaultPickerCalendarId(calendars, "family")).toBe("default");
  });

  it("uses the event-dialog swatch trigger", () => {
    render(
      <CalendarEventCalendarPicker
        calendars={calendars}
        calendarId="default"
        labels={defaultCalendarLabels}
        onCalendarIdChange={vi.fn()}
      />,
    );

    const trigger = screen.getByRole("button", { name: /Calendar: Personal/i });
    expect(trigger.className).toContain("calendar-event-dialog__calendar-trigger");
    expect(trigger.querySelector(".calendar-color-swatch-trigger__dot")).toBeTruthy();
    expect(trigger.querySelector(".calendar-color-swatch-trigger__chevron")).toBeTruthy();

    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);
    const personal = screen.getByRole("menuitem", { name: "Personal" });
    expect(personal.querySelector(".calendar-sidebar-dot")).toBeTruthy();
  });
});
