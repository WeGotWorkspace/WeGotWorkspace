import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it, vi } from "vitest";
import type { CalendarEvent } from "@/lib/calendar-engine";
import type { JmapCalendarEvent } from "@/lib/jmap-client";
import type { CalendarAPIOperations } from "@/calendar-core/src/calendar-types";
import { createCalendarEventsApi } from "@/calendar-core/src/calendar-events-api";

/** #1927: the grid's create/drag path keeps "Show as" right for all-day events. */

const calendars = [{ id: "work", name: "Work", color: "#0ea5e9", isDefault: true }];

function operationsStub(): CalendarAPIOperations {
  return {
    createEvent: vi.fn(
      async (draft) =>
        ({
          "@type": "Event",
          id: draft.id ?? "local-1",
          uid: `urn:uuid:${draft.id ?? "local-1"}`,
          title: draft.title,
          start: draft.start,
          duration: draft.duration,
          calendarIds: { [draft.calendarId]: true },
        }) as JmapCalendarEvent,
    ),
    patchEvent: vi.fn(
      async (eventId) =>
        ({
          "@type": "Event",
          id: eventId,
          uid: `urn:uuid:${eventId}`,
          title: "Patched",
          start: "2033-01-12T00:00:00",
          duration: "P1D",
          calendarIds: { work: true },
        }) as JmapCalendarEvent,
    ),
    deleteEvent: vi.fn(async () => undefined),
  };
}

function apiWithOverlay(operations: CalendarAPIOperations) {
  const overlay: { current?: Map<string, CalendarEvent> } = {};
  return createCalendarEventsApi({
    getEvents: () => overlay.current ?? new Map(),
    calendars,
    operations,
    onEventsChanged: (events) => {
      overlay.current = events;
    },
  });
}

describe("grid create and drag keep Show as", () => {
  it("creates an all-day event from the grid as Free and a timed one as Busy", async () => {
    const operations = operationsStub();
    const context = apiWithOverlay(operations);
    context.create({
      event: {
        calendarId: "work",
        data: {
          summary: "Deadline",
          allDay: true,
          start: Temporal.PlainDateTime.from("2033-01-11T00:00:00"),
          duration: Temporal.Duration.from("P1D"),
        },
      },
    });
    context.create({
      event: {
        calendarId: "work",
        data: {
          summary: "Standup",
          start: Temporal.PlainDateTime.from("2033-01-11T09:00:00"),
          duration: Temporal.Duration.from("PT30M"),
        },
      },
    });
    await vi.waitFor(() => expect(operations.createEvent).toHaveBeenCalledTimes(2));
    expect(operations.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Deadline", allDay: true, freeBusyStatus: "free" }),
    );
    expect(operations.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Standup", freeBusyStatus: "busy" }),
    );
  });

  it("a drag patches the time only, never Show as, alerts or links", async () => {
    const operations = operationsStub();
    const context = apiWithOverlay(operations);
    const created = context.create({
      event: {
        calendarId: "work",
        data: {
          summary: "Deadline",
          allDay: true,
          start: Temporal.PlainDateTime.from("2033-01-11T00:00:00"),
          duration: Temporal.Duration.from("P1D"),
        },
      },
    });
    const key = [...created.nextState.keys()][0];
    context.move({ target: { key }, scope: "single", delta: Temporal.Duration.from("P1D") });

    await vi.waitFor(() => expect(operations.patchEvent).toHaveBeenCalled());
    const patch = vi.mocked(operations.patchEvent).mock.calls[0][1];
    expect(patch).toMatchObject({ start: "2033-01-12T00:00:00", allDay: true });
    expect(patch).not.toHaveProperty("freeBusyStatus");
    expect(patch).not.toHaveProperty("alerts");
    expect(patch).not.toHaveProperty("links");
  });
});
