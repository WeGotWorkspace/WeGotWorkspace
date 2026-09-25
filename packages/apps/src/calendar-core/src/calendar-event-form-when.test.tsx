import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CalendarEventFormWhen } from "@/calendar-core/src/calendar-event-form-when";
import { emptyCalendarEventForm } from "@/calendar-core/src/calendar-editor-model";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import { TooltipProvider } from "@/ui/tooltip";

const labels = defaultCalendarLabels;

afterEach(() => {
  cleanup();
});

function renderWhen(
  form = emptyCalendarEventForm("default", "2033-01-12", "10:00"),
  onFieldChange = vi.fn(),
) {
  render(
    <TooltipProvider>
      <CalendarEventFormWhen
        form={form}
        labels={labels}
        locale="en-US"
        controlSize="sm"
        disabled={false}
        onFieldChange={onFieldChange}
      />
    </TooltipProvider>,
  );
  return { onFieldChange };
}

describe("CalendarEventFormWhen", () => {
  it("keeps time inputs for timed events and reports start time edits", () => {
    const { onFieldChange } = renderWhen();

    expect(document.querySelectorAll('input[type="time"]')).toHaveLength(2);
    expect(document.querySelector(".calendar-event-dialog__field--timezone")).not.toBeNull();
    expect(
      document.querySelector(".calendar-event-dialog__time-slot")?.getAttribute("aria-hidden"),
    ).toBeNull();

    fireEvent.change(screen.getByLabelText(`${labels.eventStartLabel} time`), {
      target: { value: "11:30" },
    });
    expect(onFieldChange).toHaveBeenCalledWith("startTime", "11:30");
  });

  it("hides time inputs and the time zone row for all-day events", () => {
    const form = { ...emptyCalendarEventForm("default", "2033-01-12"), allDay: true };
    renderWhen(form);

    expect(document.querySelectorAll('input[type="time"]')).toHaveLength(0);
    expect(document.querySelector(".calendar-event-dialog__field--timezone")).toBeNull();
    expect(document.querySelector(".calendar-event-dialog__all-day-caption")?.textContent).toBe(
      labels.eventAllDayLabel,
    );
    expect(
      document.querySelector(".calendar-event-dialog__time-slot")?.getAttribute("aria-hidden"),
    ).toBe("true");
    expect(screen.queryByRole("combobox", { name: labels.eventTimeZoneLabel })).toBeNull();
  });

  it("reports all-day and time zone changes", () => {
    const { onFieldChange } = renderWhen({
      ...emptyCalendarEventForm("default", "2033-01-12", "10:00"),
      timeZone: "Europe/Amsterdam",
    });

    fireEvent.click(screen.getByRole("switch", { name: labels.eventAllDayLabel }));
    expect(onFieldChange).toHaveBeenCalledWith("allDay", true);

    fireEvent.click(screen.getByRole("combobox", { name: labels.eventTimeZoneLabel }));
    fireEvent.click(screen.getByRole("option", { name: /^UTC$/i }));
    expect(onFieldChange).toHaveBeenCalledWith("timeZone", "UTC");
  });

  it("disables schedule controls while the form is busy or read-only", () => {
    render(
      <TooltipProvider>
        <CalendarEventFormWhen
          form={emptyCalendarEventForm("default", "2033-01-12", "10:00")}
          labels={labels}
          locale="en-US"
          controlSize="sm"
          disabled
          onFieldChange={vi.fn()}
        />
      </TooltipProvider>,
    );

    expect(
      screen.getByRole("switch", { name: labels.eventAllDayLabel }).hasAttribute("disabled"),
    ).toBe(true);
    expect(screen.getByLabelText(`${labels.eventStartLabel} time`).hasAttribute("disabled")).toBe(
      true,
    );
  });
});
