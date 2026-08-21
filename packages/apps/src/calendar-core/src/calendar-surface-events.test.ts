import { describe, expect, it } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import type { CalendarEvent, CalendarEventsMap } from "@/lib/calendar-engine";
import type { JmapCalendarEvent } from "@/lib/jmap-client";
import { resolveCalendarSurfaceEvents } from "@/calendar-core/src/calendar-surface-events";

function wireEvent(start: string, title = "Dentist"): JmapCalendarEvent {
  return {
    "@type": "Event",
    id: "dentist",
    uid: "urn:uuid:dentist",
    calendarIds: { default: true },
    title,
    start,
    duration: "PT45M",
    timeZone: "Etc/UTC",
  } as JmapCalendarEvent;
}

function adapterEvent(start: string): CalendarEventsMap {
  const events: CalendarEventsMap = new Map();
  events.set("dentist", {
    eventId: "dentist",
    calendarId: "default",
    data: {
      start: Temporal.PlainDateTime.from(start),
      duration: Temporal.Duration.from("PT45M"),
      summary: "Dentist",
    },
  } as CalendarEvent);
  return events;
}

describe("resolveCalendarSurfaceEvents", () => {
  it("does not paint stale cache events while the online adapter is loading", () => {
    const events = resolveCalendarSurfaceEvents({
      phase: "loading",
      cacheEvents: [wireEvent("2033-01-12T11:00:00")],
    });
    expect(events.size).toBe(0);
  });

  it("paints adapter events once ready (post-drag server times)", () => {
    const events = resolveCalendarSurfaceEvents({
      phase: "ready",
      adapterEvents: adapterEvent("2033-01-12T15:00:00"),
      cacheEvents: [wireEvent("2033-01-12T11:00:00")],
    });
    expect(events.get("dentist")?.data.start.toString()).toBe("2033-01-12T15:00:00");
  });

  it("falls back to cache when there is no client or the adapter failed", () => {
    const cached = [wireEvent("2033-01-12T11:00:00")];
    expect(
      resolveCalendarSurfaceEvents({
        phase: "cache",
        cacheEvents: cached,
      })
        .get("dentist")
        ?.data.start.toString(),
    ).toBe("2033-01-12T11:00:00");
    expect(
      resolveCalendarSurfaceEvents({
        phase: "failed",
        cacheEvents: cached,
      })
        .get("dentist")
        ?.data.start.toString(),
    ).toBe("2033-01-12T11:00:00");
  });
});
