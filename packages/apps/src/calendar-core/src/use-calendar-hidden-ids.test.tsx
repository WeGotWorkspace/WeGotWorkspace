import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { CalendarInfo } from "@/calendar-core/src/calendar-types";
import { useCalendarHiddenIds } from "@/calendar-core/src/use-calendar-hidden-ids";

const baseCalendars: CalendarInfo[] = [
  { id: "default", name: "Personal", color: "#6366f1" },
  { id: "work", name: "Work", color: "#0ea5e9" },
  { id: "holidays", name: "US Holidays", color: "#8b5cf6", isVisible: false },
];

describe("useCalendarHiddenIds", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("keeps a server-default-hidden calendar visible after the user un-hides it", () => {
    const first = renderHook(() => useCalendarHiddenIds(baseCalendars));
    expect(first.result.current.hiddenCalendarIds.has("holidays")).toBe(true);

    act(() => {
      first.result.current.setHiddenCalendarIds(new Set());
    });
    expect(first.result.current.hiddenCalendarIds.has("holidays")).toBe(false);
    first.unmount();

    const second = renderHook(() => useCalendarHiddenIds(baseCalendars));
    expect(second.result.current.hiddenCalendarIds.has("holidays")).toBe(false);
  });

  it("hides a new server-default-hidden calendar after prefs already exist", () => {
    const first = renderHook(() => useCalendarHiddenIds(baseCalendars));
    first.unmount();

    const second = renderHook(() =>
      useCalendarHiddenIds([
        ...baseCalendars,
        { id: "birthdays", name: "Birthdays", color: "#111827", isVisible: false },
      ]),
    );
    expect(second.result.current.hiddenCalendarIds.has("birthdays")).toBe(true);
    expect(second.result.current.hiddenCalendarIds.has("holidays")).toBe(true);
  });

  it("hides a newly arrived server-default-hidden calendar without a remount", () => {
    const { result, rerender } = renderHook(({ calendars }) => useCalendarHiddenIds(calendars), {
      initialProps: { calendars: baseCalendars },
    });

    rerender({
      calendars: [
        ...baseCalendars,
        { id: "birthdays", name: "Birthdays", color: "#111827", isVisible: false },
      ],
    });

    expect(result.current.hiddenCalendarIds.has("birthdays")).toBe(true);
  });
});
