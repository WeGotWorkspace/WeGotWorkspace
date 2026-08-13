import { describe, expect, it } from "vitest";
import type { JmapCalendarEvent } from "@/lib/jmap-client";
import {
  eventIsRecurringSeries,
  exclusionRecurrenceOverrides,
  occurrenceRecurrenceOverrides,
  splitOccurrenceKey,
  toLocalRecurrenceId,
  truncateRecurrenceRules,
  untilBeforeRecurrenceId,
} from "@/calendar-core/src/calendar-recurrence-scope";
import type { CalendarEventFormValue } from "@/calendar-core/src/calendar-editor-model";

describe("calendar-recurrence-scope", () => {
  it("splits occurrence keys", () => {
    expect(splitOccurrenceKey("master")).toEqual({ masterId: "master" });
    expect(splitOccurrenceKey("master::2026-01-01T10:00:00")).toEqual({
      masterId: "master",
      recurrenceId: "2026-01-01T10:00:00",
    });
    expect(splitOccurrenceKey("master::20260311T090000")).toEqual({
      masterId: "master",
      recurrenceId: "20260311T090000",
    });
  });

  it("detects recurring series from wire rules", () => {
    expect(eventIsRecurringSeries({ recurrenceRules: undefined })).toBe(false);
    expect(
      eventIsRecurringSeries({
        recurrenceRules: [{ "@type": "RecurrenceRule", frequency: "weekly" }],
      }),
    ).toBe(true);
  });

  it("normalizes compact engine recurrence ids to LocalDateTime", () => {
    expect(toLocalRecurrenceId("20260311T090000", false)).toBe("2026-03-11T09:00:00");
    expect(toLocalRecurrenceId("20260311", true)).toBe("2026-03-11");
    expect(toLocalRecurrenceId("2026-03-11T09:00:00", false)).toBe("2026-03-11T09:00:00");
  });

  it("computes until before a timed recurrence id", () => {
    expect(untilBeforeRecurrenceId("2033-01-12T10:00:00", false)).toBe("2033-01-12T09:59:59");
    expect(untilBeforeRecurrenceId("20330112T100000", false)).toBe("2033-01-12T09:59:59");
  });

  it("computes until before an all-day recurrence id", () => {
    expect(untilBeforeRecurrenceId("2033-01-12", true)).toBe("2033-01-11");
    expect(untilBeforeRecurrenceId("20330112", true)).toBe("2033-01-11");
  });

  it("truncates recurrence rules with until and drops count", () => {
    expect(
      truncateRecurrenceRules(
        [{ "@type": "RecurrenceRule", frequency: "weekly", count: 10 }],
        "2033-01-11",
      ),
    ).toEqual([{ "@type": "RecurrenceRule", frequency: "weekly", until: "2033-01-11" }]);
  });

  it("builds an exclusion override for only-this delete", () => {
    const original = {
      id: "ev-1",
      "@type": "Event",
      uid: "u1",
      start: "2026-03-09T09:00:00",
      calendarIds: { "cal-work": true },
      recurrenceOverrides: {
        "2026-03-11T09:00:00": { title: "Moved" },
      },
    } as JmapCalendarEvent;
    expect(exclusionRecurrenceOverrides(original, "20260316T090000")).toEqual({
      "2026-03-11T09:00:00": { title: "Moved" },
      "2026-03-16T09:00:00": { excluded: true },
    });
  });

  it("builds an occurrence override patch from the editor form", () => {
    const original = {
      id: "ev-1",
      "@type": "Event",
      uid: "u1",
      title: "Standup",
      start: "2026-03-09T09:00:00",
      duration: "PT30M",
      calendarIds: { "cal-work": true },
      recurrenceRules: [{ "@type": "RecurrenceRule", frequency: "weekly" }],
    } as JmapCalendarEvent;
    const form: CalendarEventFormValue = {
      title: "Standup (moved)",
      calendarId: "cal-work",
      allDay: false,
      startDate: "2026-03-11",
      startTime: "11:00",
      endDate: "2026-03-11",
      endTime: "11:30",
      timeZone: null,
      location: "",
      description: "",
      recurrencePreset: "weekly",
    };
    expect(occurrenceRecurrenceOverrides(form, original, "20260311T090000")).toEqual({
      "2026-03-11T09:00:00": {
        title: "Standup (moved)",
        start: "2026-03-11T11:00:00",
      },
    });
  });
});
