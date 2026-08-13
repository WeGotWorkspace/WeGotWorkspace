import {
  resolveEventEnd,
  type CalendarEvent,
  type CalendarEventData,
  type CalendarEventEnvelope,
  type CalendarEventsMap,
} from "@/lib/calendar-engine";

/** Flattened envelope + payload (for bridge conversions and legacy tooling). */
export type CalendarEventView = CalendarEventEnvelope & CalendarEventData;
export type CalendarEventViewMap = Map<string, CalendarEventView>;

export function resolvedDataEnd(data: CalendarEventData) {
  return "end" in data && data.end !== undefined ? data.end : resolveEventEnd(data);
}

/** Maps a UI row to `@lit-calendar/events-api` `CalendarEvent` (envelope fields + `data`). */
export function eventViewToApiEvent(event: CalendarEventView): CalendarEvent {
  return {
    accountId: event.accountId,
    calendarId: event.calendarId,
    eventId: event.eventId,
    recurrenceId: event.recurrenceId,
    isRecurring: event.isRecurring,
    isException: event.isException,
    pendingOp: event.pendingOp,
    data: {
      start: event.start,
      end: event.end,
      allDay: event.allDay,
      timeZone: event.timeZone,
      summary: event.summary,
      ...(event.color !== undefined && event.color !== "" ? { color: event.color } : {}),
      location: event.location,
      recurrenceRule: event.recurrenceRule,
      exclusionDates: event.exclusionDates,
    } as CalendarEventData,
  };
}

export function toEventsApiMap(events: CalendarEventViewMap): CalendarEventsMap {
  return new Map(
    Array.from(events.entries()).map(([key, event]) => [key, eventViewToApiEvent(event)]),
  );
}

export function eventViewFromApiEvent(event: CalendarEvent): CalendarEventView {
  const d = event.data;
  const end = resolvedDataEnd(d);
  return {
    accountId: event.accountId,
    calendarId: event.calendarId,
    eventId: event.eventId,
    recurrenceId: event.recurrenceId,
    isRecurring: event.isRecurring,
    isException: event.isException,
    pendingOp: event.pendingOp,
    start: d.start,
    end,
    allDay: d.allDay,
    timeZone: d.timeZone,
    summary: d.summary,
    color: d.color,
    location: d.location,
    recurrenceRule: d.recurrenceRule,
    exclusionDates: d.exclusionDates,
  };
}

export function fromEventsApiMap(events: CalendarEventsMap): CalendarEventViewMap {
  return new Map(
    Array.from(events.entries()).map(([key, event]) => [key, eventViewFromApiEvent(event)]),
  );
}
