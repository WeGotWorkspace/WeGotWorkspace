import { describe, expect, it } from "vitest";
import { todayISODate } from "@/calendar-core/src/calendar-event-model";
import {
  calendarNavigateTarget,
  calendarPathFromState,
  calendarRouteKey,
  calendarStateFromLocation,
  DEFAULT_CALENDAR_VIEW,
  isCalendarPathname,
  isCalendarViewId,
  parseCalendarISODate,
} from "@/calendar-core/src/calendar-route-search";

describe("calendar-route-search", () => {
  it("parses grid and list path segments into view, date, and presentation", () => {
    expect(calendarStateFromLocation("/calendar/week/2026-08-17")).toEqual({
      view: "week",
      date: "2026-08-17",
      presentation: "grid",
    });
    expect(calendarStateFromLocation("/calendar/list/week/2026-08-17")).toEqual({
      view: "week",
      date: "2026-08-17",
      presentation: "list",
    });
    expect(calendarStateFromLocation("/calendar/day/2026-08-17")).toEqual({
      view: "day",
      date: "2026-08-17",
      presentation: "grid",
    });
    expect(calendarStateFromLocation("/calendar/list/year/2026-01-01")).toEqual({
      view: "year",
      date: "2026-01-01",
      presentation: "list",
    });
  });

  it("falls back to today's defaults for missing or invalid segments", () => {
    const today = todayISODate();
    expect(calendarStateFromLocation("/calendar")).toEqual({
      view: DEFAULT_CALENDAR_VIEW,
      date: today,
      presentation: "grid",
    });
    expect(calendarStateFromLocation("/calendar/list")).toEqual({
      view: DEFAULT_CALENDAR_VIEW,
      date: today,
      presentation: "list",
    });
    expect(calendarStateFromLocation("/calendar/week")).toEqual({
      view: "week",
      date: today,
      presentation: "grid",
    });
    expect(calendarStateFromLocation("/calendar/not-a-view/2026-08-17")).toEqual({
      view: DEFAULT_CALENDAR_VIEW,
      date: "2026-08-17",
      presentation: "grid",
    });
    expect(calendarStateFromLocation("/calendar/week/17-08-2026")).toEqual({
      view: "week",
      date: today,
      presentation: "grid",
    });
    expect(calendarStateFromLocation("/calendar/week/2026-13-40")).toEqual({
      view: "week",
      date: today,
      presentation: "grid",
    });
    expect(calendarStateFromLocation("/notes/all")).toEqual({
      view: DEFAULT_CALENDAR_VIEW,
      date: today,
      presentation: "grid",
    });
  });

  it("uses injected fallbacks only when the path omits view or presentation", () => {
    const today = todayISODate();
    const fallbacks = { view: "week" as const, presentation: "list" as const };
    expect(calendarStateFromLocation("/calendar", {}, fallbacks)).toEqual({
      view: "week",
      date: today,
      presentation: "list",
    });
    expect(calendarStateFromLocation("/calendar/list", {}, fallbacks)).toEqual({
      view: "week",
      date: today,
      presentation: "list",
    });
    expect(calendarStateFromLocation("/calendar/day/2026-08-17", {}, fallbacks)).toEqual({
      view: "day",
      date: "2026-08-17",
      presentation: "grid",
    });
  });

  it("prefers pathname slugs when route params are not yet available", () => {
    expect(calendarStateFromLocation("/calendar/month/2026-08-17", {})).toEqual({
      view: "month",
      date: "2026-08-17",
      presentation: "grid",
    });
    expect(calendarStateFromLocation("/calendar/list/day/2026-08-01", {})).toEqual({
      view: "day",
      date: "2026-08-01",
      presentation: "list",
    });
  });

  it("serializes controller state to the canonical path and navigate target", () => {
    expect(calendarPathFromState({ view: "week", date: "2026-08-17", presentation: "grid" })).toBe(
      "/calendar/week/2026-08-17",
    );
    expect(calendarPathFromState({ view: "week", date: "2026-08-17", presentation: "list" })).toBe(
      "/calendar/list/week/2026-08-17",
    );
    expect(
      calendarNavigateTarget({ view: "week", date: "2026-08-17", presentation: "grid" }),
    ).toEqual({
      to: "/calendar/$view/$date",
      params: { view: "week", date: "2026-08-17" },
    });
    expect(
      calendarNavigateTarget({ view: "day", date: "2026-08-17", presentation: "list" }),
    ).toEqual({
      to: "/calendar/list/$view/$date",
      params: { view: "day", date: "2026-08-17" },
    });
  });

  it("round-trips parse → serialize for valid paths", () => {
    for (const path of [
      "/calendar/month/2026-08-17",
      "/calendar/week/2026-08-17",
      "/calendar/day/2026-08-01",
      "/calendar/year/2026-01-01",
      "/calendar/list/month/2026-08-17",
      "/calendar/list/week/2026-08-17",
    ]) {
      expect(calendarPathFromState(calendarStateFromLocation(path))).toBe(path);
    }
  });

  it("recognizes only /calendar paths", () => {
    expect(isCalendarPathname("/calendar")).toBe(true);
    expect(isCalendarPathname("/calendar/week/2026-08-17")).toBe(true);
    expect(isCalendarPathname("/calendar/list/month/2026-08-17")).toBe(true);
    expect(isCalendarPathname("/contacts")).toBe(false);
    expect(isCalendarPathname("/notes/all")).toBe(false);
    expect(isCalendarPathname("/calendars")).toBe(false);
  });

  it("validates view ids and ISO dates", () => {
    expect(isCalendarViewId("month")).toBe(true);
    expect(isCalendarViewId("agenda")).toBe(false);
    expect(parseCalendarISODate("2026-08-17")).toBe("2026-08-17");
    expect(parseCalendarISODate("2026-08-17T10:00:00")).toBeNull();
    expect(parseCalendarISODate("August 17, 2026")).toBeNull();
    expect(calendarRouteKey({ view: "week", date: "2026-08-17", presentation: "list" })).toBe(
      "list:week:2026-08-17",
    );
  });
});
