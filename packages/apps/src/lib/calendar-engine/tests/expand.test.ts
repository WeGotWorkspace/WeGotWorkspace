import { describe, expect, it } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import type { CalendarEventsMap } from "../types/event.js";
import { expandEvents } from "../core/expandEvents.js";
import { UTC_TIMEZONE } from "../types/event/timezone.js";
import { createDailySeriesState } from "./support/mockEvents.js";

describe("expandEvents", () => {
  it("expands a daily recurrence and applies exclusion dates", () => {
    const events = createDailySeriesState();
    events.set("daily", {
      ...events.get("daily")!,
      data: {
        ...events.get("daily")!.data,
        recurrenceRule: { freq: "DAILY", interval: 1, count: 3 },
        exclusionDates: new Set(["20250114T090000"]),
      },
    });

    const rendered = expandEvents(events, {
      start: Temporal.PlainDateTime.from("2025-01-13T00:00:00"),
      end: Temporal.PlainDateTime.from("2025-01-20T00:00:00"),
    });

    expect(rendered.has("daily::20250113T090000")).toBe(true);
    expect(rendered.has("daily::20250114T090000")).toBe(false);
    expect(rendered.has("daily::20250115T090000")).toBe(true);
  });

  it("suppresses the original slot when exception eventId is a uid and the map key is the persist id", () => {
    const events: CalendarEventsMap = new Map([
      [
        "ev-1",
        {
          eventId: "urn:uuid:ev-1",
          data: {
            start: Temporal.PlainDateTime.from("2025-01-13T09:00:00"),
            end: Temporal.PlainDateTime.from("2025-01-13T09:15:00"),
            summary: "Daily",
            recurrenceRule: { freq: "DAILY", interval: 1, count: 2 },
          },
        },
      ],
      [
        "ev-1::20250114T090000",
        {
          eventId: "ev-1",
          recurrenceId: "20250114T090000",
          isException: true,
          data: {
            start: Temporal.PlainDateTime.from("2025-01-14T11:00:00"),
            end: Temporal.PlainDateTime.from("2025-01-14T11:15:00"),
            summary: "Daily (moved)",
          },
        },
      ],
    ]);

    const rendered = expandEvents(events, {
      start: Temporal.PlainDateTime.from("2025-01-13T00:00:00"),
      end: Temporal.PlainDateTime.from("2025-01-20T00:00:00"),
    });

    const starts = [...rendered.values()].map((event) => event.data.start.toString()).sort();
    expect(starts).toEqual(["2025-01-13T09:00:00", "2025-01-14T11:00:00"]);
  });

  it("suppresses generated occurrence when detached exception exists", () => {
    const events: CalendarEventsMap = new Map([
      [
        "daily",
        {
          eventId: "daily@example.test",
          data: {
            start: Temporal.PlainDateTime.from("2025-01-13T09:00:00"),
            end: Temporal.PlainDateTime.from("2025-01-13T09:15:00"),
            summary: "Daily",
            color: "#10B981",
            recurrenceRule: { freq: "DAILY", interval: 1, count: 2 },
            exclusionDates: new Set(),
          },
        },
      ],
      [
        "daily::20250114T090000",
        {
          eventId: "daily@example.test",
          recurrenceId: "20250114T090000",
          data: {
            start: Temporal.PlainDateTime.from("2025-01-14T11:00:00"),
            end: Temporal.PlainDateTime.from("2025-01-14T11:15:00"),
            summary: "Daily (moved)",
            color: "#10B981",
          },
        },
      ],
    ]);

    const rendered = expandEvents(events, {
      start: Temporal.PlainDateTime.from("2025-01-13T00:00:00"),
      end: Temporal.PlainDateTime.from("2025-01-20T00:00:00"),
    });

    expect(rendered.has("daily::20250113T090000")).toBe(true);
    expect(rendered.has("daily::20250114T090000")).toBe(true);
    const exception = rendered.get("daily::20250114T090000");
    expect(exception?.data.start.toString()).toBe("2025-01-14T11:00:00");
  });

  it("suppresses the zoned series instance when a this-instance override exists (#609)", () => {
    const events: CalendarEventsMap = new Map([
      [
        "daily",
        {
          eventId: "daily@example.test",
          data: {
            start: Temporal.PlainDateTime.from("2025-01-13T09:00:00"),
            end: Temporal.PlainDateTime.from("2025-01-13T09:15:00"),
            summary: "Daily",
            color: "#10B981",
            timeZone: UTC_TIMEZONE,
            recurrenceRule: { freq: "DAILY", interval: 1, count: 2 },
          },
        },
      ],
      [
        "daily::20250114T090000",
        {
          eventId: "daily@example.test",
          recurrenceId: "20250114T090000",
          isException: true,
          data: {
            start: Temporal.PlainDateTime.from("2025-01-14T11:00:00"),
            end: Temporal.PlainDateTime.from("2025-01-14T11:15:00"),
            summary: "Daily (moved)",
            color: "#10B981",
          },
        },
      ],
    ]);

    const rendered = expandEvents(
      events,
      {
        start: Temporal.PlainDateTime.from("2025-01-13T00:00:00"),
        end: Temporal.PlainDateTime.from("2025-01-20T00:00:00"),
      },
      { timezone: "Europe/Amsterdam" },
    );

    expect([...rendered.keys()]).toEqual(["daily::20250113T090000", "daily::20250114T090000"]);
    expect(rendered.get("daily::20250114T090000")?.data.summary).toBe("Daily (moved)");
    expect(rendered.get("daily::20250114T090000")?.data.start.toString()).toBe(
      "2025-01-14T11:00:00",
    );
  });

  it("expands monthly last Friday recurrences using byDay + bySetPos", () => {
    const events: CalendarEventsMap = new Map([
      [
        "monthly-last-friday",
        {
          eventId: "monthly-last-friday@example.test",
          data: {
            start: Temporal.PlainDateTime.from("2025-01-06T09:00:00"),
            end: Temporal.PlainDateTime.from("2025-01-06T10:00:00"),
            summary: "Monthly Last Friday",
            color: "#0ea5e9",
            recurrenceRule: {
              freq: "MONTHLY",
              interval: 1,
              byDay: [{ day: "FR" }],
              bySetPos: [-1],
              count: 3,
            },
          },
        },
      ],
    ]);

    const rendered = expandEvents(events, {
      start: Temporal.PlainDateTime.from("2025-01-01T00:00:00"),
      end: Temporal.PlainDateTime.from("2025-04-01T00:00:00"),
    });

    expect(Array.from(rendered.keys())).toEqual([
      "monthly-last-friday::20250131T090000",
      "monthly-last-friday::20250228T090000",
      "monthly-last-friday::20250328T090000",
    ]);
  });

  it("expands monthly last-Friday byDay ordinal over a multi-year search window", () => {
    const events: CalendarEventsMap = new Map([
      [
        "sprint-retro",
        {
          eventId: "sprint-retro@example.test",
          data: {
            start: Temporal.PlainDateTime.from("2026-08-24T15:00:00"),
            end: Temporal.PlainDateTime.from("2026-08-24T16:00:00"),
            summary: "Sprint retro",
            recurrenceRule: {
              freq: "MONTHLY",
              interval: 1,
              byDay: [{ day: "FR", ordinal: -1 }],
            },
          },
        },
      ],
    ]);

    const rendered = expandEvents(events, {
      start: Temporal.PlainDateTime.from("2025-08-01T00:00:00"),
      end: Temporal.PlainDateTime.from("2028-08-01T00:00:00"),
    });

    expect(rendered.size).toBeGreaterThan(20);
    expect([...rendered.values()].every((event) => event.data.summary === "Sprint retro")).toBe(
      true,
    );
    expect(rendered.has("sprint-retro::20260828T150000")).toBe(true);
  });
});
