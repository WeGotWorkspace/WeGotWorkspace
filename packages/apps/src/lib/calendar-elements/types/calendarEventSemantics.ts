import type {
  CalendarEvent,
  CalendarEventData,
  CalendarEventEnvelope,
} from "@/lib/calendar-engine";
import type { CalendarEventView } from "../domain/events-api/eventMapBridge.js";

export type CalendarEventLike = CalendarEvent | CalendarEventView;

function resolveEventEnvelope(event: CalendarEventLike): CalendarEventEnvelope {
  if ("data" in event) {
    const e = event;
    return {
      accountId: e.accountId,
      calendarId: e.calendarId,
      eventId: e.eventId,
      recurrenceId: e.recurrenceId,
      isRecurring: e.isRecurring,
      isException: e.isException,
      pendingOp: e.pendingOp,
    };
  }
  return event;
}

function resolveEventContent(event: CalendarEventLike): CalendarEventData {
  return "data" in event ? event.data : event;
}

export function isCalendarEventException(event: CalendarEventLike): boolean {
  const envelope = resolveEventEnvelope(event);
  if (envelope.isException === true) return true;
  if (!envelope.recurrenceId) return false;
  if (isCalendarEventExcluded(event)) return false;
  const content = resolveEventContent(event);
  return !content.recurrenceRule;
}

export function isCalendarEventExcluded(event: CalendarEventLike): boolean {
  const envelope = resolveEventEnvelope(event);
  if (!envelope.recurrenceId) return false;
  const content = resolveEventContent(event);
  return Boolean(content.exclusionDates?.has(envelope.recurrenceId));
}

export function isCalendarEventRecurring(event: CalendarEventLike): boolean {
  if (isCalendarEventExcluded(event) || isCalendarEventException(event)) return false;
  const envelope = resolveEventEnvelope(event);
  const content = resolveEventContent(event);
  return Boolean(content.recurrenceRule || envelope.isRecurring || envelope.recurrenceId);
}
