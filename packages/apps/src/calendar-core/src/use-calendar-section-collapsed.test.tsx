import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useCalendarSectionCollapsed } from "@/calendar-core/src/use-calendar-section-collapsed";
import {
  CALENDAR_VIEW_PREFS_STORAGE_KEY,
  calendarViewPrefs,
} from "@/calendar-core/src/calendar-view-prefs";

describe("useCalendarSectionCollapsed", () => {
  beforeEach(() => window.localStorage.clear());

  it("starts open and remembers the fold per section", () => {
    const reminders = renderHook(() => useCalendarSectionCollapsed("remindersCollapsed"));
    expect(reminders.result.current.collapsed).toBe(false);
    act(() => reminders.result.current.toggleCollapsed());
    expect(reminders.result.current.collapsed).toBe(true);
    expect(calendarViewPrefs.read()).toMatchObject({ remindersCollapsed: true });
    expect(calendarViewPrefs.read()?.availabilityCollapsed).toBeUndefined();

    const again = renderHook(() => useCalendarSectionCollapsed("remindersCollapsed"));
    expect(again.result.current.collapsed).toBe(true);
    const team = renderHook(() => useCalendarSectionCollapsed("availabilityCollapsed"));
    expect(team.result.current.collapsed).toBe(false);
  });

  it("ignores a stored value that is not a boolean", () => {
    window.localStorage.setItem(
      CALENDAR_VIEW_PREFS_STORAGE_KEY,
      JSON.stringify({ remindersCollapsed: "yes" }),
    );
    const { result } = renderHook(() => useCalendarSectionCollapsed("remindersCollapsed"));
    expect(result.current.collapsed).toBe(false);
  });
});
