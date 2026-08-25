import type { CalendarEventsMap } from "@/lib/calendar-engine";

export type EventMapKeyEnvelope = {
  eventId?: string;
  accountId?: string;
  calendarId?: string;
  recurrenceId?: string;
};

function matchesCalendarAndAccount(
  event: { calendarId?: string; accountId?: string },
  envelope: EventMapKeyEnvelope,
): boolean {
  if (envelope.calendarId !== undefined && event.calendarId !== envelope.calendarId) return false;
  if (envelope.accountId !== undefined && event.accountId !== envelope.accountId) return false;
  return true;
}

/**
 * Map a UI update/delete envelope to an engine working-set key.
 * `envelope.eventId` is the persist / JSCalendar id (often the master), not
 * the rendered occurrence key. When a recurrenceId is present, prefer the
 * detached exception row so a second this-instance drag does not move the series.
 */
export function resolveEventMapKey(
  events: CalendarEventsMap,
  envelope: EventMapKeyEnvelope,
): string | undefined {
  if (!envelope.eventId) return undefined;

  if (envelope.recurrenceId) {
    const occurrenceKey = `${envelope.eventId}::${envelope.recurrenceId}`;
    if (events.has(occurrenceKey)) return occurrenceKey;
    for (const [key, event] of events.entries()) {
      if (event.eventId !== envelope.eventId) continue;
      if (!matchesCalendarAndAccount(event, envelope)) continue;
      if (event.recurrenceId === envelope.recurrenceId) return key;
    }
  }

  if (events.has(envelope.eventId)) return envelope.eventId;

  let fallbackSeriesKey: string | undefined;
  for (const [key, event] of events.entries()) {
    if (event.eventId !== envelope.eventId) continue;
    if (!matchesCalendarAndAccount(event, envelope)) continue;
    if (envelope.recurrenceId === undefined || event.recurrenceId === envelope.recurrenceId)
      return key;
    if (event.recurrenceId === undefined && fallbackSeriesKey === undefined)
      fallbackSeriesKey = key;
  }
  return fallbackSeriesKey;
}
