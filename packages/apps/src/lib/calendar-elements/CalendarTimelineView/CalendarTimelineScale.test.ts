import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import {
  type CalendarTimelineScale,
  alignedMonthGridStart,
  alignedWeekStart,
  compareDaySnappedRenderOrder,
  currentTimeMarkersAcrossDays,
  composedTimedScrollTop,
  fromTimelineRange,
  fromTimelineValue,
  resolveTimelineEventFilter,
  resolveVisibleHoursZoom,
  timelineGridMax,
  timelineRangeOverlapsCell,
  toTimelineAllDayRange,
  toTimelineRange,
  toTimelineValue,
  visibleHoursWindow,
  yearMonthStarts,
} from "./CalendarTimelineScale.js";

const MINUTES_PER_DAY = 24 * 60;

function minuteScale(): CalendarTimelineScale {
  return {
    startDate: Temporal.PlainDate.from("2025-01-05"),
    numDays: 7,
    unitsPerDay: MINUTES_PER_DAY,
  };
}

function coarseScale(): CalendarTimelineScale {
  return {
    startDate: Temporal.PlainDate.from("2025-01-05"),
    numDays: 7,
    unitsPerDay: 24,
  };
}

describe("toTimelineValue / fromTimelineValue round trip", () => {
  it("round-trips a datetime exactly with minute-granularity units", () => {
    const scale = minuteScale();
    const dateTime = Temporal.PlainDateTime.from("2025-01-07T09:30:00");
    const value = toTimelineValue(dateTime, scale);
    expect(value).toBe(2 * MINUTES_PER_DAY + 9 * 60 + 30);
    expect(fromTimelineValue(value, scale).toString()).toBe(dateTime.toString());
  });

  it("round-trips with fractional axis values (24 units per day)", () => {
    const scale = coarseScale();
    const dateTime = Temporal.PlainDateTime.from("2025-01-06T18:15:00");
    const value = toTimelineValue(dateTime, scale);
    expect(value).toBeCloseTo(24 + 18.25, 10);
    expect(fromTimelineValue(value, scale).toString()).toBe(dateTime.toString());
  });

  it("maps day boundaries onto whole multiples of unitsPerDay", () => {
    const scale = minuteScale();
    for (let day = 0; day <= scale.numDays; day++) {
      const boundary = scale.startDate.add({ days: day }).toPlainDateTime("00:00");
      expect(toTimelineValue(boundary, scale)).toBe(day * MINUTES_PER_DAY);
      expect(fromTimelineValue(day * MINUTES_PER_DAY, scale).toString()).toBe(boundary.toString());
    }
  });
});

describe("currentTimeMarkersAcrossDays (full-width now indicator)", () => {
  it("expands a mid-week now into one marker per day at the same time-of-day", () => {
    const unitsPerDay = MINUTES_PER_DAY;
    const wednesday = 2 * unitsPerDay + 19 * 60 + 37;
    expect(currentTimeMarkersAcrossDays(wednesday, unitsPerDay, 7)).toEqual(
      Array.from({ length: 7 }, (_, day) => day * unitsPerDay + 19 * 60 + 37),
    );
  });

  it("returns a single marker for day view", () => {
    const unitsPerDay = MINUTES_PER_DAY;
    const value = 10 * 60 + 15;
    expect(currentTimeMarkersAcrossDays(value, unitsPerDay, 1)).toEqual([value]);
  });

  it("returns [] when now falls outside the rendered range", () => {
    const unitsPerDay = MINUTES_PER_DAY;
    expect(currentTimeMarkersAcrossDays(-1, unitsPerDay, 7)).toEqual([]);
    expect(currentTimeMarkersAcrossDays(7 * unitsPerDay, unitsPerDay, 7)).toEqual([]);
  });
});

describe("gesture commit conversions (numeric commit -> datetimes)", () => {
  it("converts a moved numeric range back to shifted datetimes", () => {
    const scale = minuteScale();
    const start = Temporal.PlainDateTime.from("2025-01-06T10:00:00");
    const end = Temporal.PlainDateTime.from("2025-01-06T11:00:00");
    const original = toTimelineRange(start, end, scale);

    // Simulate a move commit: +90 minutes on the axis, duration preserved.
    const moved = fromTimelineRange(original.start + 90, original.end + 90, scale);
    expect(moved.start.toString()).toBe("2025-01-06T11:30:00");
    expect(moved.end.toString()).toBe("2025-01-06T12:30:00");
  });

  it("converts a resize-end commit while the start edge round-trips exactly", () => {
    const scale = minuteScale();
    const start = Temporal.PlainDateTime.from("2025-01-08T14:00:00");
    const end = Temporal.PlainDateTime.from("2025-01-08T15:00:00");
    const original = toTimelineRange(start, end, scale);

    const resized = fromTimelineRange(original.start, original.end + 45, scale);
    expect(resized.start.toString()).toBe(start.toString());
    expect(resized.end.toString()).toBe("2025-01-08T15:45:00");
  });

  it("moves across a day boundary land on the expected calendar day", () => {
    const scale = minuteScale();
    const start = Temporal.PlainDateTime.from("2025-01-05T23:00:00");
    const end = Temporal.PlainDateTime.from("2025-01-06T00:30:00");
    const original = toTimelineRange(start, end, scale);

    const moved = fromTimelineRange(
      original.start + MINUTES_PER_DAY,
      original.end + MINUTES_PER_DAY,
      scale,
    );
    expect(moved.start.toString()).toBe("2025-01-06T23:00:00");
    expect(moved.end.toString()).toBe("2025-01-07T00:30:00");
  });

  it("whole-day rounding of an axis value matches the intended day boundary", () => {
    // Mirrors the all-day commit path: Math.round(value / unitsPerDay) days from startDate.
    const scale = minuteScale();
    const draggedTo = 3 * MINUTES_PER_DAY + 200; // partway into day 3
    const dayIndex = Math.round(draggedTo / scale.unitsPerDay);
    expect(dayIndex).toBe(3);
    const rounded = scale.startDate.add({ days: dayIndex }).toPlainDateTime("00:00");
    expect(rounded.toString()).toBe("2025-01-08T00:00:00");
    expect(toTimelineValue(rounded, scale)).toBe(3 * MINUTES_PER_DAY);
  });
});

describe("toTimelineAllDayRange", () => {
  it("snaps a timed event to its full day", () => {
    const scale = minuteScale();
    const range = toTimelineAllDayRange(
      Temporal.PlainDateTime.from("2025-01-06T09:00:00"),
      Temporal.PlainDateTime.from("2025-01-06T10:00:00"),
      scale,
    );
    expect(range.start).toBe(1 * MINUTES_PER_DAY);
    expect(range.end).toBe(2 * MINUTES_PER_DAY);
  });

  it("keeps a midnight-exclusive end as-is", () => {
    const scale = minuteScale();
    const range = toTimelineAllDayRange(
      Temporal.PlainDateTime.from("2025-01-06T00:00:00"),
      Temporal.PlainDateTime.from("2025-01-08T00:00:00"),
      scale,
    );
    expect(range.start).toBe(1 * MINUTES_PER_DAY);
    expect(range.end).toBe(3 * MINUTES_PER_DAY);
  });

  it("guarantees at least one day of span", () => {
    const scale = minuteScale();
    const start = Temporal.PlainDateTime.from("2025-01-06T00:00:00");
    const range = toTimelineAllDayRange(start, start, scale);
    expect(range.end - range.start).toBe(MINUTES_PER_DAY);
  });
});

describe("timelineGridMax", () => {
  it("is unitsPerDay * numDays", () => {
    expect(timelineGridMax(minuteScale())).toBe(7 * MINUTES_PER_DAY);
    expect(timelineGridMax(coarseScale())).toBe(7 * 24);
  });
});

describe("alignedWeekStart (week-mode window alignment, grid-week parity)", () => {
  it("aligns a mid-week anchor back to a Monday week start", () => {
    // 2025-01-08 is a Wednesday; the Monday on/before is 2025-01-06.
    const start = alignedWeekStart(Temporal.PlainDate.from("2025-01-08"), 1);
    expect(start.toString()).toBe("2025-01-06");
    expect(start.dayOfWeek).toBe(1);
  });

  it("aligns to a Sunday week start", () => {
    // Sunday on/before 2025-01-08 (Wednesday) is 2025-01-05.
    const start = alignedWeekStart(Temporal.PlainDate.from("2025-01-08"), 7);
    expect(start.toString()).toBe("2025-01-05");
    expect(start.dayOfWeek).toBe(7);
  });

  it("keeps an anchor already on the week start", () => {
    // 2025-01-06 is a Monday.
    const start = alignedWeekStart(Temporal.PlainDate.from("2025-01-06"), 1);
    expect(start.toString()).toBe("2025-01-06");
  });

  it("crosses month/year boundaries backwards when needed", () => {
    // 2025-01-01 is a Wednesday; Monday-aligned window starts 2024-12-30.
    const start = alignedWeekStart(Temporal.PlainDate.from("2025-01-01"), 1);
    expect(start.toString()).toBe("2024-12-30");
  });

  it("never lands after the anchor and always on the requested weekday", () => {
    for (let weekStart = 1; weekStart <= 7; weekStart++) {
      for (let day = 1; day <= 14; day++) {
        const anchor = Temporal.PlainDate.from({ year: 2025, month: 6, day });
        const start = alignedWeekStart(anchor, weekStart);
        expect(start.dayOfWeek).toBe(weekStart);
        expect(Temporal.PlainDate.compare(start, anchor)).toBeLessThanOrEqual(0);
        expect(anchor.since(start).days).toBeLessThan(7);
      }
    }
  });
});

describe("resolveVisibleHoursZoom (grid visibleHours -> hour-height zoom)", () => {
  it("passes through an in-range window", () => {
    expect(resolveVisibleHoursZoom(8, 8)).toEqual({ hours: 8, startHour: 8 });
  });

  it("defaults the start hour to 0", () => {
    expect(resolveVisibleHoursZoom(12)).toEqual({ hours: 12, startHour: 0 });
  });

  it("clamps the start hour so the window stays within the day", () => {
    expect(resolveVisibleHoursZoom(8, 22)).toEqual({ hours: 8, startHour: 16 });
    expect(resolveVisibleHoursZoom(8, -3)).toEqual({ hours: 8, startHour: 0 });
  });

  it("clamps the hour count to 1–24 (24 stays explicit: no min-height floor)", () => {
    expect(resolveVisibleHoursZoom(0.5)).toEqual({ hours: 1, startHour: 0 });
    expect(resolveVisibleHoursZoom(48, 6)).toEqual({ hours: 24, startHour: 0 });
    expect(resolveVisibleHoursZoom(24)).toEqual({ hours: 24, startHour: 0 });
  });

  it("returns null for unset or invalid values (default hour sizing applies)", () => {
    expect(resolveVisibleHoursZoom(undefined)).toBeNull();
    expect(resolveVisibleHoursZoom(0)).toBeNull();
    expect(resolveVisibleHoursZoom(-4)).toBeNull();
    expect(resolveVisibleHoursZoom(Number.NaN)).toBeNull();
  });

  it("yields the grid-parity sizing math (hour height x 24 = scrollable day height)", () => {
    // 8 visible hours in a 640px timed viewport: 80px per hour, 1920px full day, initial
    // scroll of startHour x hour height.
    const zoom = resolveVisibleHoursZoom(8, 8);
    expect(zoom).not.toBeNull();
    const viewportPx = 640;
    const hourHeightPx = viewportPx / (zoom?.hours ?? 24);
    expect(hourHeightPx).toBe(80);
    expect(24 * hourHeightPx).toBe(1920);
    expect((zoom?.startHour ?? 0) * hourHeightPx).toBe(640);
  });
});

describe("composedTimedScrollTop (day/week auto-scroll)", () => {
  const timedHeightPx = 1920; // 80px/hour × 24
  const timedViewportPx = 640; // 8 visible hours

  it("centers the now marker when today is in range", () => {
    // Noon → 960px down the timed grid; center in 640px viewport → scroll 960 - 320 = 640
    expect(
      composedTimedScrollTop({
        timedHeightPx,
        timedViewportPx,
        nowDayFraction: 0.5,
        fallbackStartHour: 8,
      }),
    ).toBe(640);
  });

  it("includes the timed gap above the grid when centering now", () => {
    expect(
      composedTimedScrollTop({
        timedHeightPx,
        timedViewportPx,
        timedGapPx: 8,
        nowDayFraction: 0.5,
        fallbackStartHour: 8,
      }),
    ).toBe(648);
  });

  it("falls back to visibleHoursStart when today is out of range", () => {
    expect(
      composedTimedScrollTop({
        timedHeightPx,
        timedViewportPx,
        nowDayFraction: null,
        fallbackStartHour: 8,
      }),
    ).toBe(640);
  });

  it("clamps to [0, maxScrollTop] near day edges", () => {
    expect(
      composedTimedScrollTop({
        timedHeightPx,
        timedViewportPx,
        nowDayFraction: 0,
        fallbackStartHour: 8,
        maxScrollTop: 1280,
      }),
    ).toBe(0);
    expect(
      composedTimedScrollTop({
        timedHeightPx,
        timedViewportPx,
        nowDayFraction: 1,
        fallbackStartHour: 8,
        maxScrollTop: 1280,
      }),
    ).toBe(1280);
  });
});

describe("alignedMonthGridStart (month-mode 42-cell window)", () => {
  it("aligns the 1st of the month back to a Monday week start", () => {
    // 2025-01-01 is a Wednesday; Monday-aligned window starts 2024-12-30.
    const start = alignedMonthGridStart(Temporal.PlainDate.from("2025-01-15"), 1);
    expect(start.toString()).toBe("2024-12-30");
    expect(start.dayOfWeek).toBe(1);
  });

  it("aligns to a Sunday week start", () => {
    // Sunday on/before 2025-01-01 is 2024-12-29.
    const start = alignedMonthGridStart(Temporal.PlainDate.from("2025-01-15"), 7);
    expect(start.toString()).toBe("2024-12-29");
    expect(start.dayOfWeek).toBe(7);
  });

  it("keeps the 1st when it already falls on the week start", () => {
    // 2025-09-01 is a Monday.
    const start = alignedMonthGridStart(Temporal.PlainDate.from("2025-09-10"), 1);
    expect(start.toString()).toBe("2025-09-01");
  });

  it("covers the whole month within 42 cells", () => {
    for (const iso of ["2025-01-01", "2025-02-01", "2025-03-01", "2024-02-29"]) {
      const anchor = Temporal.PlainDate.from(iso);
      const start = alignedMonthGridStart(anchor, 1);
      const windowEnd = start.add({ days: 42 });
      const lastOfMonth = anchor.with({ day: anchor.daysInMonth });
      expect(Temporal.PlainDate.compare(start, anchor.with({ day: 1 }))).toBeLessThanOrEqual(0);
      expect(Temporal.PlainDate.compare(lastOfMonth, windowEnd)).toBeLessThan(0);
    }
  });
});

describe("resolveTimelineEventFilter (per-presentation all-day filtering)", () => {
  it("shows everything for timed presentations (gantt, horizontal timed)", () => {
    expect(resolveTimelineEventFilter(undefined, "timed")).toBe("all");
    expect(resolveTimelineEventFilter("timed", "timed")).toBe("all");
  });

  it("shows everything, day-snapped, for a preset all-day mapping (month day cells)", () => {
    expect(resolveTimelineEventFilter(undefined, "all-day")).toBe("all");
  });

  it("keeps only all-day events for the explicit standalone all-day variant", () => {
    expect(resolveTimelineEventFilter("all-day", "all-day")).toBe("all-day-only");
  });
});

describe("compareDaySnappedRenderOrder (conventional cell stacking)", () => {
  const entry = (start: string, end: string, summary: string, allDay = false) => ({
    start: Temporal.PlainDateTime.from(start),
    end: Temporal.PlainDateTime.from(end),
    summary,
    allDay,
  });

  it("orders by start date first", () => {
    const early = entry("2025-01-14T15:00", "2025-01-14T16:00", "B");
    const late = entry("2025-01-15T09:00", "2025-01-15T09:30", "A");
    expect(compareDaySnappedRenderOrder(early, late)).toBeLessThan(0);
    expect(compareDaySnappedRenderOrder(late, early)).toBeGreaterThan(0);
  });

  it("puts longer spans before shorter ones on the same start date", () => {
    const multiDay = entry("2025-01-15T00:00", "2025-01-18T00:00", "Zebra Offsite", true);
    const timed = entry("2025-01-15T09:00", "2025-01-15T09:30", "Alpha Standup");
    expect(compareDaySnappedRenderOrder(multiDay, timed)).toBeLessThan(0);
  });

  it("puts all-day events before timed events on the same day, regardless of summary", () => {
    const allDay = entry("2025-01-15T00:00", "2025-01-16T00:00", "Team Offsite", true);
    const timed = entry("2025-01-15T09:00", "2025-01-15T09:30", "Daily Standup");
    expect(compareDaySnappedRenderOrder(allDay, timed)).toBeLessThan(0);
    expect(compareDaySnappedRenderOrder(timed, allDay)).toBeGreaterThan(0);
  });

  it("orders same-day timed events by start time, not summary", () => {
    const afternoon = entry("2025-01-15T16:30", "2025-01-15T17:30", "Drinks");
    const morning = entry("2025-01-15T09:00", "2025-01-15T09:30", "Standup");
    expect(compareDaySnappedRenderOrder(morning, afternoon)).toBeLessThan(0);
    expect(compareDaySnappedRenderOrder(afternoon, morning)).toBeGreaterThan(0);
  });

  it("falls back to summary for same-day all-day events", () => {
    const design = entry("2025-01-15T00:00", "2025-01-16T00:00", "Design Review", true);
    const engineering = entry("2025-01-15T00:00", "2025-01-16T00:00", "Engineering Sync", true);
    expect(compareDaySnappedRenderOrder(design, engineering)).toBeLessThan(0);
    expect(compareDaySnappedRenderOrder(engineering, design)).toBeGreaterThan(0);
  });

  it("stacks a day cell as all-day events first, then timed events by start time", () => {
    const designReview = entry("2025-01-15T00:00", "2025-01-16T00:00", "Design Review", true);
    const drinks = entry("2025-01-15T16:30", "2025-01-15T17:30", "Drinks");
    const engineeringSync = entry("2025-01-15T00:00", "2025-01-16T00:00", "Engineering Sync", true);
    const sorted = [designReview, drinks, engineeringSync].sort(compareDaySnappedRenderOrder);
    expect(sorted.map((e) => e.summary)).toEqual(["Design Review", "Engineering Sync", "Drinks"]);
  });
});

describe("yearMonthStarts (year-mode month windows)", () => {
  it("returns the first day of all 12 months of the anchor's year", () => {
    const months = yearMonthStarts(Temporal.PlainDate.from("2025-06-18"));
    expect(months).toHaveLength(12);
    expect(months[0]?.toString()).toBe("2025-01-01");
    expect(months[5]?.toString()).toBe("2025-06-01");
    expect(months[11]?.toString()).toBe("2025-12-01");
    expect(months.every((month) => month.year === 2025 && month.day === 1)).toBe(true);
  });

  it("is anchored by year only (any day of the year yields the same windows)", () => {
    const fromJanuary = yearMonthStarts(Temporal.PlainDate.from("2024-01-01"));
    const fromLeapDay = yearMonthStarts(Temporal.PlainDate.from("2024-02-29"));
    expect(fromJanuary.map(String)).toEqual(fromLeapDay.map(String));
  });
});

describe("timelineRangeOverlapsCell (per-day-cell event lookup)", () => {
  const units = MINUTES_PER_DAY;

  it("matches ranges inside, spanning, and touching the cell", () => {
    // Cell 2 spans [2 * units, 3 * units).
    expect(timelineRangeOverlapsCell({ start: 2 * units, end: 3 * units }, 2, units)).toBe(true);
    expect(
      timelineRangeOverlapsCell({ start: 2 * units + 60, end: 2 * units + 120 }, 2, units),
    ).toBe(true);
    expect(timelineRangeOverlapsCell({ start: 0, end: 7 * units }, 2, units)).toBe(true);
  });

  it("treats ranges as [start, end): boundaries do not bleed into neighbours", () => {
    const dayRange = { start: 1 * units, end: 2 * units };
    expect(timelineRangeOverlapsCell(dayRange, 0, units)).toBe(false);
    expect(timelineRangeOverlapsCell(dayRange, 1, units)).toBe(true);
    expect(timelineRangeOverlapsCell(dayRange, 2, units)).toBe(false);
  });
});

describe("visibleHoursWindow (grid visibleHours -> axis window)", () => {
  it("maps a sub-range of hours onto axis units", () => {
    // 8 visible hours starting at 08:00 with minute units: window 480–960.
    expect(visibleHoursWindow(MINUTES_PER_DAY, 8, 8)).toEqual({
      windowStart: 480,
      windowEnd: 960,
    });
  });

  it("defaults the start hour to 0", () => {
    expect(visibleHoursWindow(MINUTES_PER_DAY, 12)).toEqual({
      windowStart: 0,
      windowEnd: 720,
    });
  });

  it("clamps the start hour so the window stays within the day", () => {
    expect(visibleHoursWindow(MINUTES_PER_DAY, 8, 22)).toEqual({
      windowStart: 16 * 60,
      windowEnd: MINUTES_PER_DAY,
    });
  });

  it("returns the full range for unset or full-day values", () => {
    const full = { windowStart: 0, windowEnd: null };
    expect(visibleHoursWindow(MINUTES_PER_DAY, undefined)).toEqual(full);
    expect(visibleHoursWindow(MINUTES_PER_DAY, 24)).toEqual(full);
    expect(visibleHoursWindow(MINUTES_PER_DAY, 0)).toEqual(full);
    expect(visibleHoursWindow(MINUTES_PER_DAY, Number.NaN)).toEqual(full);
  });

  it("scales with non-minute axis units", () => {
    expect(visibleHoursWindow(24, 6, 9)).toEqual({ windowStart: 9, windowEnd: 15 });
  });
});
