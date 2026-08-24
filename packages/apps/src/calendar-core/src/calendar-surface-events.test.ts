import { describe, expect, it } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import { resolveEventEnd, type CalendarEvent, type CalendarEventsMap } from "@/lib/calendar-engine";
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

function workingEvent(start: string, pendingOp?: CalendarEvent["pendingOp"]): CalendarEventsMap {
  const events: CalendarEventsMap = new Map();
  events.set("dentist", {
    eventId: "dentist",
    calendarId: "default",
    pendingOp,
    data: {
      start: Temporal.PlainDateTime.from(start),
      duration: Temporal.Duration.from("PT45M"),
      summary: "Dentist",
    },
  } as CalendarEvent);
  return events;
}

describe("resolveCalendarSurfaceEvents", () => {
  it("paints the Dexie/bootstrap cache when the working set is empty", () => {
    const events = resolveCalendarSurfaceEvents({
      cacheEvents: [wireEvent("2033-01-12T11:00:00")],
    });
    expect(events.get("dentist")?.data.start.toString()).toBe("2033-01-12T11:00:00");
  });

  it("keeps a pending working-set move when the cache is still at the old slot", () => {
    const events = resolveCalendarSurfaceEvents({
      workingSet: workingEvent("2033-01-12T15:00:00", "updated"),
      cacheEvents: [wireEvent("2033-01-12T11:00:00")],
    });
    expect(events.get("dentist")?.data.start.toString()).toBe("2033-01-12T15:00:00");
  });

  it("keeps a pending working-set resize when the cache still has the old duration", () => {
    const working: CalendarEventsMap = new Map();
    working.set("dentist", {
      eventId: "dentist",
      calendarId: "default",
      pendingOp: "updated",
      data: {
        start: Temporal.PlainDateTime.from("2033-01-12T11:00:00"),
        end: Temporal.PlainDateTime.from("2033-01-12T13:00:00"),
        summary: "Dentist",
      },
    } as CalendarEvent);
    const events = resolveCalendarSurfaceEvents({
      workingSet: working,
      cacheEvents: [wireEvent("2033-01-12T11:00:00")],
    });
    expect(events.get("dentist")?.data.start.toString()).toBe("2033-01-12T11:00:00");
    expect(resolveEventEnd(events.get("dentist")!.data).toString()).toBe("2033-01-12T13:00:00");
  });

  it("does not paint adapter-empty as a wipe when the working set still has cards", () => {
    const events = resolveCalendarSurfaceEvents({
      workingSet: workingEvent("2033-01-12T15:00:00", "updated"),
      cacheEvents: [],
    });
    expect(events.size).toBe(1);
    expect(events.get("dentist")?.eventId).toBe("dentist");
  });

  it("paints one card when the working set still has local- and cache has the remapped server row", () => {
    const working: CalendarEventsMap = new Map();
    working.set("local-temp", {
      eventId: "local-temp",
      calendarId: "default",
      pendingOp: "updated",
      data: {
        start: Temporal.PlainDateTime.from("2033-01-12T11:00:00"),
        duration: Temporal.Duration.from("PT45M"),
        summary: "Dentist",
      },
    } as CalendarEvent);
    const events = resolveCalendarSurfaceEvents({
      workingSet: working,
      cacheEvents: [wireEvent("2033-01-12T11:00:00")],
    });
    expect(events.size).toBe(1);
    expect(events.has("dentist")).toBe(true);
    expect(events.has("local-temp")).toBe(false);
    expect(events.get("dentist")?.eventId).toBe("dentist");
  });

  it("paints one card when a pending patched row and remapped server row share identity", () => {
    const working: CalendarEventsMap = new Map();
    working.set("ev-old", {
      eventId: "ev-old",
      calendarId: "default",
      pendingOp: "updated",
      data: {
        start: Temporal.PlainDateTime.from("2033-01-12T11:00:00"),
        duration: Temporal.Duration.from("PT45M"),
        summary: "Dentist",
      },
    } as CalendarEvent);
    const events = resolveCalendarSurfaceEvents({
      workingSet: working,
      cacheEvents: [wireEvent("2033-01-12T11:00:00")],
    });
    expect(events.size).toBe(1);
    expect(events.has("dentist")).toBe(true);
    expect(events.has("ev-old")).toBe(false);
  });

  it("keeps an offline delete omitted when the cache snapshot is stale", () => {
    const working: CalendarEventsMap = new Map();
    working.set("dentist", {
      eventId: "dentist",
      calendarId: "default",
      pendingOp: "deleted",
      data: {
        start: Temporal.PlainDateTime.from("2033-01-12T11:00:00"),
        duration: Temporal.Duration.from("PT45M"),
        summary: "Dentist",
      },
    } as CalendarEvent);
    const events = resolveCalendarSurfaceEvents({
      workingSet: working,
      cacheEvents: [wireEvent("2033-01-12T11:00:00")],
    });
    expect(events.has("dentist")).toBe(false);
  });
});
