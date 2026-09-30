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
    expect(trigger.className).toContain("control-surface--size-md");
    expect(trigger.querySelector(".color-swatch-trigger__dot")).toBeTruthy();
    expect(trigger.querySelector(".color-swatch-trigger__chevron")).toBeTruthy();
    expect(trigger.querySelector(".color-swatch-trigger__caption")).toBeNull();
    expect(trigger.textContent?.trim()).toBe("");

    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);
    const personal = screen.getByRole("menuitem", { name: "Personal" });
    expect(personal.querySelector(".calendar-sidebar-dot")).toBeTruthy();
    expect(personal.textContent).toContain("Personal");
    const menu = document.querySelector(".calendar-event-dialog__calendar-menu");
    expect(menu).toBeTruthy();
    expect(menu?.className).not.toContain("calendar-event-dialog__calendar-menu--match-trigger");
  });

  it("shows the calendar name on the closed trigger when showName is set", () => {
    render(
      <CalendarEventCalendarPicker
        calendars={calendars}
        calendarId="work"
        labels={defaultCalendarLabels}
        showName
        onCalendarIdChange={vi.fn()}
      />,
    );

    const trigger = screen.getByRole("button", { name: /Calendar: Work/i });
    expect(trigger.className).toContain("color-swatch-trigger--labeled");
    expect(trigger.querySelector(".color-swatch-trigger__caption")?.textContent).toBe("Work");

    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);
    const menu = document.querySelector(".calendar-event-dialog__calendar-menu");
    expect(menu).toBeTruthy();
    expect(menu?.className).toContain("calendar-event-dialog__calendar-menu--match-trigger");
    expect(menu?.getAttribute("data-align")).toBe("start");
  });
});
