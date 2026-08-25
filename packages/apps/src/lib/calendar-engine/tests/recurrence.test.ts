import { describe, expect, it } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import type { CalendarEvent, CalendarEventsMap } from "../types/event.js";
import {
  isThisInstanceOverride,
  occurrenceMapKey,
  parseRecurrenceId,
  shiftRecurrenceId,
  splitOccurrenceKey,
  toRecurrenceId,
} from "../utils/recurrence.js";

describe("recurrence helpers", () => {
  it("formats and parses timed recurrence ids", () => {
    const templateStart = Temporal.PlainDateTime.from("2025-01-13T09:00:00");
    const value = Temporal.PlainDateTime.from("2025-01-18T11:15:00");
    const recurrenceId = toRecurrenceId(value, false);
    expect(recurrenceId).toBe("20250118T111500");
    const parsed = parseRecurrenceId(recurrenceId, false, templateStart);
    expect(parsed?.toString()).toBe("2025-01-18T11:15:00");
  });

  it("formats and parses date-only recurrence ids", () => {
    const templateStart = Temporal.PlainDateTime.from("2025-01-13T09:00:00");
    const value = Temporal.PlainDateTime.from("2025-01-18T00:00:00");
    const recurrenceId = toRecurrenceId(value, true);
    expect(recurrenceId).toBe("20250118");
    const parsed = parseRecurrenceId(recurrenceId, true, templateStart);
    expect(parsed?.toString()).toBe("2025-01-18T00:00:00");
  });

  it("shifts recurrence ids by duration", () => {
    const templateStart = Temporal.PlainDateTime.from("2025-01-13T09:00:00");
    const shifted = shiftRecurrenceId(
      "20250118T090000",
      false,
      templateStart,
      Temporal.Duration.from({ hours: 1 }),
    );
    expect(shifted).toBe("20250118T100000");
  });

  it("splits and builds occurrence map keys", () => {
    expect(splitOccurrenceKey("master")).toEqual({ masterId: "master" });
    expect(splitOccurrenceKey("master::20260311T090000")).toEqual({
      masterId: "master",
      recurrenceId: "20260311T090000",
    });
    expect(occurrenceMapKey("master", "20260311T090000")).toBe("master::20260311T090000");
  });

  it("detects a this-instance override from the resolved map key", () => {
    const exception: CalendarEvent = {
      eventId: "ev-1",
      recurrenceId: "20330111T100000",
      isException: true,
      data: {
        summary: "Daily",
        start: Temporal.PlainDateTime.from("2033-01-11T11:00:00"),
        duration: Temporal.Duration.from("PT30M"),
      },
    };
    const events: CalendarEventsMap = new Map([
      [
        "ev-1",
        {
          eventId: "ev-1",
          isRecurring: true,
          data: {
            summary: "Daily",
            start: Temporal.PlainDateTime.from("2033-01-10T10:00:00"),
            duration: Temporal.Duration.from("PT30M"),
            recurrenceRule: { freq: "DAILY", interval: 1 },
          },
        },
      ],
      ["ev-1::20330111T100000", exception],
    ]);

    expect(isThisInstanceOverride(events, "ev-1::20330111T100000")).toBe(true);
    expect(isThisInstanceOverride(events, "ev-1")).toBe(false);
  });

  it("detects a this-instance override when the row is stored under a non-canonical key", () => {
    const exception: CalendarEvent = {
      eventId: "ev-1",
      recurrenceId: "20330111T100000",
      isException: true,
      data: {
        summary: "Daily",
        start: Temporal.PlainDateTime.from("2033-01-11T11:00:00"),
        duration: Temporal.Duration.from("PT30M"),
      },
    };
    const events: CalendarEventsMap = new Map([["legacy-exception-row", exception]]);

    expect(isThisInstanceOverride(events, "ev-1::20330111T100000")).toBe(true);
    expect(isThisInstanceOverride(events, "legacy-exception-row")).toBe(true);
  });
});
