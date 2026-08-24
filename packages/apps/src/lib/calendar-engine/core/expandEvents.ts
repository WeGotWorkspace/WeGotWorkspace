import type { Temporal } from "@js-temporal/polyfill";
import type { CalendarEvent, CalendarEventsMap } from "../types/event.js";
import {
  collectDetachedExceptionKeys,
  resolveEventEnd,
  toPlainDateTime,
  toRecurrenceId,
} from "../utils/recurrence.js";
import { expandRecurringStarts } from "../utils/rrule-adapter.js";
import { plainDateTimeToUtcMs, rangesOverlapMs, utcMsToPlainDateTime } from "../utils/epoch.js";

type ExpandEventsRange = {
  start: Temporal.PlainDateTime;
  end: Temporal.PlainDateTime;
};

type ExpandEventsOptions = {
  timezone?: string;
};

export function expandEvents(
  events: CalendarEventsMap,
  range: ExpandEventsRange,
  options: ExpandEventsOptions = {},
): CalendarEventsMap {
  const rangeStart = toPlainDateTime(range.start);
  const rangeEnd = toPlainDateTime(range.end);
  const rangeStartMs = plainDateTimeToUtcMs(rangeStart);
  const rangeEndMs = plainDateTimeToUtcMs(rangeEnd);
  if (rangeEndMs <= rangeStartMs) return new Map();

  const detachedExceptionKeys = collectDetachedExceptionKeys(events);
  const renderedEvents: CalendarEventsMap = new Map();

  for (const [id, event] of events) {
    if (event.pendingOp === "deleted") continue;
    if (event.data.recurrenceRule && !event.recurrenceId) {
      const baseStart = toPlainDateTime(event.data.start);
      const baseEnd = toPlainDateTime(resolveEventEnd(event.data));
      const baseStartMs = plainDateTimeToUtcMs(baseStart);
      const baseEndMs = plainDateTimeToUtcMs(baseEnd);
      if (baseEndMs <= baseStartMs) continue;
      const durationMs = baseEndMs - baseStartMs;
      const occurrenceStarts = expandRecurringStarts(event, rangeStart, rangeEnd, {
        timezone: options.timezone,
      });

      for (const occurrenceStart of occurrenceStarts) {
        const recurrenceId = toRecurrenceId(occurrenceStart, event.data.allDay ?? false);
        const hasDetachedException =
          Boolean(event.eventId) && detachedExceptionKeys.has(`${event.eventId}::${recurrenceId}`);
        if (hasDetachedException) continue;
        const occurrenceStartMs = plainDateTimeToUtcMs(occurrenceStart);
        const occurrenceEndMs = occurrenceStartMs + durationMs;
        if (!rangesOverlapMs(occurrenceStartMs, occurrenceEndMs, rangeStartMs, rangeEndMs)) {
          continue;
        }
        const occurrenceEnd = utcMsToPlainDateTime(occurrenceEndMs);
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
    if (
      !rangesOverlapMs(
        plainDateTimeToUtcMs(start),
        plainDateTimeToUtcMs(end),
        rangeStartMs,
        rangeEndMs,
      )
    ) {
      continue;
    }
    renderedEvents.set(id, event);
  }
  return renderedEvents;
}
