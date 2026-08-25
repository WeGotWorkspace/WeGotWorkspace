import { describe, expect, it, vi } from "vitest";
import type { CalendarAPIOperations } from "@/calendar-core/src/calendar-types";
import {
  filterIcsFiles,
  icsFileFromList,
  inferCalendarNameFromIcsFileName,
  isIcsFile,
  readIcsFile,
  runCalendarIcsImport,
} from "@/calendar-core/src/calendar-ics-import";

function fileListOf(...files: File[]): FileList {
  return {
    length: files.length,
    item(index: number) {
      return files[index] ?? null;
    },
    [Symbol.iterator]() {
      return files[Symbol.iterator]();
    },
  } as unknown as FileList;
}

describe("isIcsFile", () => {
  it("accepts .ics, .ical, and text/calendar", () => {
    expect(isIcsFile(new File(["x"], "events.ics"))).toBe(true);
    expect(isIcsFile(new File(["x"], "events.ICS"))).toBe(true);
    expect(isIcsFile(new File(["x"], "events.ical"))).toBe(true);
    expect(isIcsFile(new File(["x"], "events.txt", { type: "text/calendar" }))).toBe(true);
  });

  it("rejects other files", () => {
    expect(isIcsFile(new File(["x"], "notes.txt", { type: "text/plain" }))).toBe(false);
  });
});

describe("filterIcsFiles", () => {
  it("keeps only ICS files", () => {
    const kept = filterIcsFiles(
      fileListOf(
        new File(["a"], "one.ics"),
        new File(["b"], "two.txt"),
        new File(["c"], "three.ICS"),
      ),
    );
    expect(kept.map((file) => file.name)).toEqual(["one.ics", "three.ICS"]);
  });
});

describe("inferCalendarNameFromIcsFileName", () => {
  it("strips .ics and .ical extensions", () => {
    expect(inferCalendarNameFromIcsFileName("team-offsite.ics")).toBe("team-offsite");
    expect(inferCalendarNameFromIcsFileName("Holidays.ICAL")).toBe("Holidays");
    expect(inferCalendarNameFromIcsFileName("  My Calendar.ics  ")).toBe("My Calendar");
  });

  it("returns empty when the basename is only an extension", () => {
    expect(inferCalendarNameFromIcsFileName(".ics")).toBe("");
    expect(inferCalendarNameFromIcsFileName("")).toBe("");
  });
});

describe("icsFileFromList", () => {
  it("returns the first ICS file or null", () => {
    expect(icsFileFromList(fileListOf(new File(["a"], "one.ics")))?.name).toBe("one.ics");
    expect(icsFileFromList(fileListOf(new File(["b"], "two.txt")))).toBeNull();
    expect(icsFileFromList(null)).toBeNull();
  });
});

describe("readIcsFile", () => {
  it("reads file text", async () => {
    const text = await readIcsFile(new File(["BEGIN:VCALENDAR"], "one.ics"));
    expect(text).toBe("BEGIN:VCALENDAR");
  });
});

describe("runCalendarIcsImport", () => {
  it("imports into an existing calendar", async () => {
    const importEvents = vi.fn().mockResolvedValue({
      list: [{ id: "ev-1", title: "Imported" }],
      errors: [],
    });
    const operations = {
      createEvent: vi.fn(),
      patchEvent: vi.fn(),
      deleteEvent: vi.fn(),
      importEvents,
    } as unknown as CalendarAPIOperations;

    const result = await runCalendarIcsImport(operations, "BEGIN:VCALENDAR", {
      mode: "existing",
      calendarId: "default",
    });

    expect(importEvents).toHaveBeenCalledWith("BEGIN:VCALENDAR", { calendarId: "default" });
    expect(result.list).toHaveLength(1);
    expect(result.calendarId).toBe("default");
  });

  it("creates a calendar then imports", async () => {
    const createCalendar = vi.fn().mockResolvedValue({
      id: "new-cal",
      name: "Travel",
      color: "#22c55e",
    });
    const importEvents = vi.fn().mockResolvedValue({ list: [{ id: "ev-1" }], errors: [] });
    const operations = {
      createEvent: vi.fn(),
      patchEvent: vi.fn(),
      deleteEvent: vi.fn(),
      createCalendar,
      importEvents,
    } as unknown as CalendarAPIOperations;

    const result = await runCalendarIcsImport(operations, "BEGIN:VCALENDAR", {
      mode: "create",
      name: "Travel",
      color: "#22c55e",
    });

    expect(createCalendar).toHaveBeenCalledWith({ name: "Travel", color: "#22c55e" });
    expect(importEvents).toHaveBeenCalledWith("BEGIN:VCALENDAR", { calendarId: "new-cal" });
    expect(result.createdCalendar?.id).toBe("new-cal");
  });
});
