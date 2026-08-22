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

  it("hides Repeat on for a daily custom rule", () => {
    render(
      <CalendarCustomRecurrenceFields
        rule={{ "@type": "RecurrenceRule", frequency: "daily" }}
        startDateISO="2033-01-12"
        labels={defaultCalendarLabels}
        locale="en-US"
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByText(defaultCalendarLabels.eventRecurrenceByDayLabel)).toBeNull();
    expect(screen.queryByRole("button", { name: "Fri" })).toBeNull();
  });

  it("shows month-day chips for monthly custom rules, not weekdays", () => {
    const onChange = vi.fn();
    render(
      <CalendarCustomRecurrenceFields
        rule={{
          "@type": "RecurrenceRule",
          frequency: "monthly",
          byMonthDay: [12],
        }}
        startDateISO="2033-01-12"
        labels={defaultCalendarLabels}
        locale="en-US"
        onChange={onChange}
      />,
    );
    expect(screen.queryByRole("button", { name: "Fri" })).toBeNull();
    expect(
      screen.getByRole("combobox", { name: defaultCalendarLabels.eventRecurrenceByDayLabel })
        .textContent,
    ).toMatch(/Days of the month/i);
    fireEvent.click(screen.getByRole("button", { name: "15" }));
    expect(onChange.mock.calls[0]![0].byMonthDay).toEqual([12, 15]);
  });

  it("shows a month-of-year grid for yearly custom rules", () => {
    const onChange = vi.fn();
    render(
      <CalendarCustomRecurrenceFields
        rule={{
          "@type": "RecurrenceRule",
          frequency: "yearly",
          byMonth: ["1"],
          byMonthDay: [12],
        }}
        startDateISO="2033-01-12"
        labels={defaultCalendarLabels}
        locale="en-US"
        onChange={onChange}
      />,
    );
    expect(screen.queryByRole("button", { name: "15" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "March" }));
    expect(onChange.mock.calls[0]![0].byMonth).toEqual(["1", "3"]);
  });

  it("lets monthly switch to last weekend-day ordinal", () => {
    const onChange = vi.fn();
    render(
      <CalendarCustomRecurrenceFields
        rule={{
          "@type": "RecurrenceRule",
          frequency: "monthly",
          byMonthDay: [12],
        }}
        startDateISO="2033-01-12"
        labels={defaultCalendarLabels}
        locale="en-US"
        onChange={onChange}
      />,
    );
    fireEvent.click(
      screen.getByRole("combobox", { name: defaultCalendarLabels.eventRecurrenceByDayLabel }),
    );
    fireEvent.click(
      screen.getByRole("option", { name: defaultCalendarLabels.eventRecurrenceOnThe }),
    );
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0].byDay?.[0]).toMatchObject({
      day: "we",
      nthOfPeriod: 2,
    });

    const ordinalRule = onChange.mock.calls[0]![0];
    cleanup();
    onChange.mockClear();
    render(
      <CalendarCustomRecurrenceFields
        rule={ordinalRule}
        startDateISO="2033-01-12"
        labels={defaultCalendarLabels}
        locale="en-US"
        onChange={onChange}
      />,
    );
    fireEvent.click(
      screen.getByRole("combobox", { name: defaultCalendarLabels.eventRecurrenceOrdinalLabel }),
    );
    fireEvent.click(
      screen.getByRole("option", { name: defaultCalendarLabels.eventRecurrenceOrdinalLast }),
    );
    const lastWednesday = onChange.mock.calls[0]![0];
    expect(lastWednesday.byDay?.[0]).toMatchObject({ day: "we", nthOfPeriod: -1 });

    cleanup();
    onChange.mockClear();
    render(
      <CalendarCustomRecurrenceFields
        rule={lastWednesday}
        startDateISO="2033-01-12"
        labels={defaultCalendarLabels}
        locale="en-US"
        onChange={onChange}
      />,
    );
    fireEvent.click(
      screen.getByRole("combobox", { name: defaultCalendarLabels.eventRecurrenceDayKindLabel }),
    );
    fireEvent.click(
      screen.getByRole("option", { name: defaultCalendarLabels.eventRecurrenceDayKindWeekend }),
    );
    expect(onChange.mock.calls[0]![0].bySetPosition).toEqual([-1]);
    expect(onChange.mock.calls[0]![0].byDay?.map((entry: { day: string }) => entry.day)).toEqual([
      "sa",
      "su",
    ]);
  });
});
