import { Temporal } from "@js-temporal/polyfill";
import type { CalendarEvent, CalendarEventsMap } from "../types/event.js";
import {
  collectDetachedExceptionKeys,
  resolveEventEnd,
  toPlainDateTime,
  toRecurrenceId,
} from "../utils/recurrence.js";
import { expandRecurringStarts } from "../utils/rrule-adapter.js";

type ExpandEventsRange = {
  start: Temporal.PlainDateTime;
  end: Temporal.PlainDateTime;
};

type ExpandEventsOptions = {
  timezone?: string;
};

function rangeOverlaps(
  start: Temporal.PlainDateTime,
  end: Temporal.PlainDateTime,
  rangeStart: Temporal.PlainDateTime,
  rangeEnd: Temporal.PlainDateTime,
): boolean {
  if (Temporal.PlainDateTime.compare(end, start) <= 0) return false;
  return (
    Temporal.PlainDateTime.compare(start, rangeEnd) < 0 &&
    Temporal.PlainDateTime.compare(end, rangeStart) > 0
  );
}

export function expandEvents(
  events: CalendarEventsMap,
  range: ExpandEventsRange,
  options: ExpandEventsOptions = {},
): CalendarEventsMap {
  const rangeStart = toPlainDateTime(range.start);
  const rangeEnd = toPlainDateTime(range.end);
  if (Temporal.PlainDateTime.compare(rangeEnd, rangeStart) <= 0) return new Map();

  const detachedExceptionKeys = collectDetachedExceptionKeys(events);
  const renderedEvents: CalendarEventsMap = new Map();

  for (const [id, event] of events) {
    if (event.pendingOp === "deleted") continue;
    if (event.data.recurrenceRule && !event.recurrenceId) {
      const baseStart = toPlainDateTime(event.data.start);
      const baseEndValue = resolveEventEnd(event.data);
      const baseEnd = toPlainDateTime(baseEndValue);
      if (Temporal.PlainDateTime.compare(baseEnd, baseStart) <= 0) continue;
      const baseDuration = baseStart.until(baseEnd);
      const occurrenceStarts = expandRecurringStarts(event, rangeStart, rangeEnd, {
        timezone: options.timezone,
      });

      for (const occurrenceStart of occurrenceStarts) {
        const recurrenceId = toRecurrenceId(occurrenceStart, event.data.allDay ?? false);
        const hasDetachedException =
          Boolean(event.eventId) && detachedExceptionKeys.has(`${event.eventId}::${recurrenceId}`);
        if (hasDetachedException) continue;
        const occurrenceEnd = occurrenceStart.add(baseDuration);
        if (!rangeOverlaps(occurrenceStart, occurrenceEnd, rangeStart, rangeEnd)) continue;
        const occurrenceKey = `${id}::${recurrenceId}`;
        const renderedOccurrence: CalendarEvent = {
          ...event,
          recurrenceId,
          data: {
            ...event.data,
            start: occurrenceStart,
            end: occurrenceEnd,
            duration: undefined,
          },
        };
        renderedEvents.set(occurrenceKey, renderedOccurrence);
      }
      continue;
    }

    const start = toPlainDateTime(event.data.start);
    const end = toPlainDateTime(resolveEventEnd(event.data));
    if (!rangeOverlaps(start, end, rangeStart, rangeEnd)) continue;
    renderedEvents.set(id, event);
  }
  return renderedEvents;
}
