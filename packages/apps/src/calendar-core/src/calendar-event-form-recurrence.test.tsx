import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyCalendarEventForm } from "@/calendar-core/src/calendar-editor-model";
import { CalendarEventFormRecurrence } from "@/calendar-core/src/calendar-event-form-recurrence";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import { TooltipProvider } from "@/ui/tooltip";

const labels = defaultCalendarLabels;

afterEach(() => {
  cleanup();
});

function renderRecurrence(
  form = emptyCalendarEventForm("default", "2033-01-12", "10:00"),
  onFieldChange = vi.fn(),
  onChange = vi.fn(),
) {
  render(
    <TooltipProvider>
      <CalendarEventFormRecurrence
        form={form}
        labels={labels}
        locale="en-US"
        controlSize="sm"
        disabled={false}
        onChange={onChange}
        onFieldChange={onFieldChange}
      />
    </TooltipProvider>,
  );
  return { onFieldChange, onChange };
}

describe("CalendarEventFormRecurrence", () => {
  it("hides series-end controls when the event does not repeat", () => {
    renderRecurrence();
    expect(screen.getByRole("combobox", { name: labels.eventRepeatLabel })).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: labels.eventRecurrenceEndsLabel })).toBeNull();
  });

  it("clears custom rules when the preset changes and leaves field changes on the field callback", () => {
    const { onChange, onFieldChange } = renderRecurrence();
    fireEvent.click(screen.getByRole("combobox", { name: labels.eventRepeatLabel }));
    fireEvent.click(screen.getByRole("option", { name: "Every day" }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        recurrencePreset: "daily",
        customRecurrenceRules: undefined,
      }),
    );
    expect(onFieldChange).not.toHaveBeenCalled();
  });

  it("shows an occurrence count for a repeating series that ends after N times", () => {
    const form = {
      ...emptyCalendarEventForm("default", "2033-01-12", "10:00"),
      recurrencePreset: "daily" as const,
      recurrenceEnds: "count" as const,
      recurrenceCount: 10,
    };
    const { onFieldChange } = renderRecurrence(form);
    const count = screen.getByRole("spinbutton", { name: labels.eventRecurrenceEndsAfter });
    fireEvent.change(count, { target: { value: "4" } });
    expect(onFieldChange).toHaveBeenCalledWith("recurrenceCount", 4);
    fireEvent.change(count, { target: { value: "nope" } });
    expect(onFieldChange).toHaveBeenCalledWith("recurrenceCount", 0);
  });

  it("shows the until date when the series ends on a date", () => {
    const form = {
      ...emptyCalendarEventForm("default", "2033-01-12", "10:00"),
      recurrencePreset: "weekly" as const,
      recurrenceEnds: "until" as const,
    };
    renderRecurrence(form);
    expect(
      screen.getByRole("button", {
        name: new RegExp(labels.eventRecurrenceEndsOnDate, "i"),
      }),
    ).toBeTruthy();
    expect(screen.queryByRole("spinbutton", { name: labels.eventRecurrenceEndsAfter })).toBeNull();
  });

  it("locks unmatched custom rules and hides series-end controls", () => {
    const form = {
      ...emptyCalendarEventForm("default", "2033-01-12", "10:00"),
      recurrencePreset: "custom" as const,
    };
    renderRecurrence(form);
    const repeat = screen.getByRole("combobox", { name: labels.eventRepeatLabel });
    expect(repeat.textContent).toMatch(/Custom/i);
    expect(repeat.hasAttribute("disabled") || repeat.getAttribute("data-disabled") !== null).toBe(
      true,
    );
    expect(screen.queryByRole("combobox", { name: labels.eventRecurrenceEndsLabel })).toBeNull();
  });

  it("reports the series-end mode through the field callback", () => {
    const form = {
      ...emptyCalendarEventForm("default", "2033-01-12", "10:00"),
      recurrencePreset: "daily" as const,
    };
    const { onFieldChange, onChange } = renderRecurrence(form);
    fireEvent.click(screen.getByRole("combobox", { name: labels.eventRecurrenceEndsLabel }));
    fireEvent.click(screen.getByRole("option", { name: labels.eventRecurrenceEndsAfter }));
    expect(onFieldChange).toHaveBeenCalledWith("recurrenceEnds", "count");
    expect(onChange).not.toHaveBeenCalled();
  });
});
