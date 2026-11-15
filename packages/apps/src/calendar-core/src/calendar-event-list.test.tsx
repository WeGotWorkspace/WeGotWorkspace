import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import { createCalendarAppBootstrap } from "@/lib/api/mock/calendar-bootstrap";
import { calendarEventsToEngineMap } from "@/calendar-core/src/calendar-event-model";
import { CalendarEventList, calendarPeriodDays } from "@/calendar-core/src/calendar-event-list";

beforeAll(() => {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => cleanup());

const bootstrap = createCalendarAppBootstrap();
const events = calendarEventsToEngineMap(bootstrap.data.events, {
  sessionEmail: bootstrap.session.user.email,
  calendars: bootstrap.data.calendars,
});
const week = {
  start: Temporal.PlainDate.from("2033-01-12"),
  end: Temporal.PlainDate.from("2033-01-14"),
};

describe("calendarPeriodDays", () => {
  it("lists the shown calendars' occurrences in the range, by day", () => {
    const days = calendarPeriodDays(events, ["work", "default"], week, "UTC");
    expect(days.map((day) => day.date.toString())).toEqual(["2033-01-12", "2033-01-13"]);
    const titles = days[0]!.items.map((item) => item.event.data.summary);
    expect(titles).toEqual(expect.arrayContaining(["Lunch?", "Design review"]));
    expect(days.flatMap((day) => day.items.map((item) => item.event.calendarId))).not.toContain(
      "family",
    );
  });

  it("is empty without a shown calendar", () => {
    expect(calendarPeriodDays(events, [], week, "UTC")).toEqual([]);
  });
});

describe("CalendarEventList", () => {
  const days = calendarPeriodDays(events, ["work"], week, "UTC");

  it("shows each row's start with its end under it", () => {
    const { container } = render(
      <CalendarEventList
        days={days}
        calendars={bootstrap.data.calendars}
        locale="en-GB"
        onItemClick={vi.fn()}
        emptyLabel="No events"
        untitledLabel="Untitled"
      />,
    );
    const review = [...container.querySelectorAll("[data-list-item-id]")].find((row) =>
      row.textContent?.includes("Design review"),
    );
    expect(review?.querySelector(".list-item__date")?.firstChild?.textContent).toBe("14:00");
    expect(review?.querySelector(".list-item__date-below")?.textContent).toMatch(/^\d\d:\d\d$/);
  });

  it("hands a row click to the selection with its occurrence key", () => {
    const onItemClick = vi.fn();
    const { container } = render(
      <CalendarEventList
        days={days}
        calendars={bootstrap.data.calendars}
        locale="en-GB"
        onItemClick={onItemClick}
        emptyLabel="No events"
        untitledLabel="Untitled"
      />,
    );
    const first = container.querySelector<HTMLElement>("[data-list-item-id]");
    fireEvent.click(first!, { metaKey: true });
    expect(onItemClick).toHaveBeenCalledWith(days[0]!.items[0]!.id, expect.anything());
  });

  it("says so when the range has no events", () => {
    const { getByText } = render(
      <CalendarEventList
        days={[]}
        calendars={[]}
        locale="en-GB"
        onItemClick={vi.fn()}
        emptyLabel="No events"
        untitledLabel="Untitled"
      />,
    );
    expect(getByText("No events")).toBeTruthy();
  });
});
