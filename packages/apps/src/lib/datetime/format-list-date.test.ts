import { afterEach, describe, expect, it, vi } from "vitest";
import { formatListDateTime, parseTimestamp } from "@/lib/datetime/format-list-date";

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

  it("shows compact date (no year) for earlier days in the current year", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 10, 18, 0, 0));
    const edited = new Date(2026, 5, 9, 8, 30, 0);
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
