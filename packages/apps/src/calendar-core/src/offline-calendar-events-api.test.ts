import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it, vi } from "vitest";
import type { CalendarEvent } from "@/lib/calendar-engine";
import type { JmapCalendarEvent } from "@/lib/jmap-client";
import type { CalendarAPIOperations } from "@/calendar-core/src/calendar-types";
import {
  calendarInfosToEngineMap,
  createOfflineCalendarEventsApi,
} from "@/calendar-core/src/offline-calendar-events-api";

function engineEvent(id: string): CalendarEvent {
  return {
    eventId: id,
    calendarId: "work",
    data: {
      summary: "Standup",
      start: Temporal.PlainDateTime.from("2033-01-10T10:00:00"),
      duration: Temporal.Duration.from("PT30M"),
    },
  };
}

function operationsStub(): CalendarAPIOperations {
  return {
    createEvent: vi.fn(
      async (draft) =>
        ({
          "@type": "Event",
          id: "local-1",
          uid: "urn:uuid:local-1",
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
          start: "2033-01-10T11:00:00",
          duration: "PT30M",
          calendarIds: { work: true },
        }) as JmapCalendarEvent,
    ),
    deleteEvent: vi.fn(async () => undefined),
  };
}

describe("createOfflineCalendarEventsApi", () => {
  const calendars = [{ id: "work", name: "Work", color: "#0ea5e9", isDefault: true }];

  it("joins cached CalendarInfo colors into getCalendars()", () => {
    const context = createOfflineCalendarEventsApi({
      getEvents: () => new Map(),
      calendars,
      operations: operationsStub(),
    });

    expect(calendarInfosToEngineMap(calendars).get("work")?.color).toBe("#0ea5e9");
    expect(context.getCalendars().get("work")?.color).toBe("#0ea5e9");
  });

  it("routes create through hybrid operations", async () => {
    const operations = operationsStub();
    const context = createOfflineCalendarEventsApi({
      getEvents: () => new Map(),
      calendars,
      operations,
    });

    context.create({
      event: {
        calendarId: "work",
        data: {
          summary: "New",
          start: Temporal.PlainDateTime.from("2033-01-11T09:00:00"),
          duration: Temporal.Duration.from("PT1H"),
        },
      },
    });

    await vi.waitFor(() => expect(operations.createEvent).toHaveBeenCalled());
  });

  it("routes patch and delete through hybrid operations", async () => {
    const operations = operationsStub();
    const events = new Map<string, CalendarEvent>([["ev-1", engineEvent("ev-1")]]);
    const onPersisted = vi.fn();
    const context = createOfflineCalendarEventsApi({
      getEvents: () => events,
      calendars,
      operations,
      onPersisted,
    });

    context.update({
      target: { key: "ev-1" },
      scope: "single",
      patch: { summary: "Moved" },
    });
    await vi.waitFor(() => expect(operations.patchEvent).toHaveBeenCalled());

    const deleteContext = createOfflineCalendarEventsApi({
      getEvents: () => events,
      calendars,
      operations,
      onPersisted,
    });
    deleteContext.remove({ target: { key: "ev-1" }, scope: "single" });

    await vi.waitFor(() => {
      expect(operations.deleteEvent).toHaveBeenCalledWith("ev-1");
      expect(onPersisted).toHaveBeenCalled();
    });
  });
});
