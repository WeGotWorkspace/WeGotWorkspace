import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarCustomRecurrenceFields } from "@/calendar-core/src/calendar-custom-recurrence-fields";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";

describe("CalendarCustomRecurrenceFields", () => {
  beforeEach(() => {
    cleanup();
  });

  it("shows frequency, interval, and by-day for a weekly custom rule", () => {
    const onChange = vi.fn();
    render(
      <CalendarCustomRecurrenceFields
        rule={{
          "@type": "RecurrenceRule",
          frequency: "weekly",
          interval: 2,
          byDay: [
            { "@type": "NDay", day: "mo" },
            { "@type": "NDay", day: "we" },
          ],
        }}
        startDateISO="2033-01-12"
        labels={defaultCalendarLabels}
        locale="en-US"
        onChange={onChange}
      />,
    );
    expect(
      screen.getByRole("combobox", { name: defaultCalendarLabels.eventRecurrenceFrequencyLabel }),
    ).toBeTruthy();
    expect(
      screen.getByRole("spinbutton", { name: defaultCalendarLabels.eventRecurrenceIntervalLabel }),
    ).toHaveProperty("value", "2");
    fireEvent.click(screen.getByRole("button", { name: "Fri" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0].byDay?.map((entry: { day: string }) => entry.day)).toEqual([
      "mo",
      "we",
      "fr",
    ]);
  });
});
