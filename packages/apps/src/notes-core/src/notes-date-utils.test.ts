import { afterEach, describe, expect, it, vi } from "vitest";
import {
  compareNotesDesc,
  formatNoteDateForDetail,
  formatNoteDateForList,
  formatNoteLastEdited,
  parseNoteTimestamp,
} from "@/notes-core/src/notes-date-utils";

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

describe("parseNoteTimestamp", () => {
  it("parses ISO timestamps and rejects invalid values", () => {
    expect(parseNoteTimestamp("2026-06-10T10:00:00.000Z")).toBe(
      Date.parse("2026-06-10T10:00:00.000Z"),
    );
    expect(parseNoteTimestamp("soon")).toBeNull();
  });
});

describe("compareNotesDesc", () => {
  it("sorts newest first by date then id", () => {
    const newer = { id: "a", date: "2026-06-10T12:00:00.000Z" };
    const older = { id: "b", date: "2026-06-09T12:00:00.000Z" };
    expect(compareNotesDesc(newer, older)).toBeLessThan(0);

    // Same timestamp: higher id sorts first (descending).
    const sameDateA = { id: "a", date: "2026-06-10T12:00:00.000Z" };
    const sameDateB = { id: "b", date: "2026-06-10T12:00:00.000Z" };
    expect(compareNotesDesc(sameDateB, sameDateA)).toBeLessThan(0);
  });

  it("prefers rows with valid dates over invalid ones", () => {
    const valid = { id: "a", date: "2026-06-10T12:00:00.000Z" };
    const invalid = { id: "b", date: "unknown" };
    expect(compareNotesDesc(valid, invalid)).toBeLessThan(0);
  });
});

describe("formatNoteDateForList", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows compact locale time for notes updated today", () => {
    vi.useFakeTimers();
    // Local calendar dates — avoids UTC/local day mismatches across timezones.
    vi.setSystemTime(new Date(2026, 5, 10, 18, 0, 0));
    const edited = new Date(2026, 5, 10, 8, 30, 0);
    expect(formatNoteDateForList(edited.toISOString())).toBe(formatTime(edited));
  });

  it("shows compact date (no year) for earlier days in the current year", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 10, 18, 0, 0));
    const edited = new Date(2026, 5, 9, 8, 30, 0);
    expect(formatNoteDateForList(edited.toISOString())).toBe(formatSameYearDate(edited));
  });

  it("includes year for notes from a previous year", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 10, 18, 0, 0));
    const edited = new Date(2025, 4, 6, 14, 0, 0);
    expect(formatNoteDateForList(edited.toISOString())).toBe(formatOtherYearDate(edited));
  });

  it("returns raw string when timestamp is invalid", () => {
    expect(formatNoteDateForList("draft")).toBe("draft");
  });
});

describe("formatNoteLastEdited", () => {
  it("uses updatedAt when display date is the em-dash placeholder", () => {
    expect(formatNoteLastEdited({ date: "—", updatedAt: "2026-08-10T12:00:00.000Z" })).toBe(
      formatNoteDateForList("2026-08-10T12:00:00.000Z"),
    );
  });

  it("returns empty when neither date nor updatedAt is a timestamp", () => {
    expect(formatNoteLastEdited({ date: "—" })).toBe("");
  });
});

describe("formatNoteDateForDetail", () => {
  it("includes weekday and year for valid timestamps", () => {
    const formatted = formatNoteDateForDetail("2026-01-05T14:00:00.000Z");
    expect(formatted.toLowerCase()).toContain("2026");
  });

  it("returns raw string when timestamp is invalid", () => {
    expect(formatNoteDateForDetail("unknown")).toBe("unknown");
  });
});
