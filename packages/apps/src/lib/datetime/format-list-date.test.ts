import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatListDateTime,
  formatRelativeDay,
  parseTimestamp,
} from "@/lib/datetime/format-list-date";

function formatTime(d: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function formatSameYearDate(d: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "short",
  }).format(d);
}

function formatOtherYearDate(d: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
}

describe("parseTimestamp", () => {
  it("parses ISO timestamps and rejects invalid values", () => {
    expect(parseTimestamp("2026-06-10T10:00:00.000Z")).toBe(Date.parse("2026-06-10T10:00:00.000Z"));
    expect(parseTimestamp("soon")).toBeNull();
  });
});

describe("formatListDateTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows compact locale time for timestamps from today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 10, 18, 0, 0));
    const edited = new Date(2026, 5, 10, 8, 30, 0);
    expect(formatListDateTime(edited.toISOString())).toBe(formatTime(edited));
  });

  it("says yesterday, in the viewer's language, for the day before", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 10, 0, 30, 0));
    const edited = new Date(2026, 5, 9, 23, 50, 0);
    const label = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(-1, "day");
    expect(formatListDateTime(edited.toISOString())).toBe(
      label.charAt(0).toLocaleUpperCase() + label.slice(1),
    );
  });

  it("shows compact date (no year) for earlier days in the current year", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 10, 18, 0, 0));
    const edited = new Date(2026, 5, 8, 8, 30, 0);
    expect(formatListDateTime(edited.toISOString())).toBe(formatSameYearDate(edited));
  });

  it("includes year for timestamps from a previous year", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 10, 18, 0, 0));
    const edited = new Date(2025, 4, 6, 14, 0, 0);
    expect(formatListDateTime(edited.toISOString())).toBe(formatOtherYearDate(edited));
  });

  it("returns raw string when timestamp is invalid", () => {
    expect(formatListDateTime("draft")).toBe("draft");
  });
});

describe("formatRelativeDay", () => {
  const now = new Date(2030, 6, 8, 23, 30);
  const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const cell = (value: number, unit: Intl.RelativeTimeFormatUnit) => {
    const label = relative.format(value, unit);
    return label.charAt(0).toLocaleUpperCase() + label.slice(1);
  };
  const day = (offset: number, hour = 9) => new Date(2030, 6, 8 + offset, hour);

  it("counts calendar days, not hours", () => {
    expect(formatRelativeDay(day(0, 0), now)).toBe(cell(0, "day"));
    expect(formatRelativeDay(day(1, 0), now)).toBe(cell(1, "day"));
    expect(formatRelativeDay(day(-1, 23), now)).toBe(cell(-1, "day"));
  });

  it("uses days, then weeks, months and years", () => {
    expect(formatRelativeDay(day(6), now)).toBe(cell(6, "day"));
    expect(formatRelativeDay(day(14), now)).toBe(cell(2, "week"));
    expect(formatRelativeDay(day(-8), now)).toBe(cell(-1, "week"));
    expect(formatRelativeDay(day(61), now)).toBe(cell(2, "month"));
    expect(formatRelativeDay(day(800), now)).toBe(cell(2, "year"));
  });

  it("keeps the case for use inside a phrase", () => {
    expect(formatRelativeDay(day(3), now, { capitalised: false })).toBe(relative.format(3, "day"));
  });
});
