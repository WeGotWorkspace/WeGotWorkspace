import { Temporal } from "@js-temporal/polyfill";
import type { CalendarEventData } from "../types/event.js";
import type { CalendarEvent, CalendarEventsMap, CalendarEventTimeSpan } from "../types/event.js";

export function toPlainDateTime(value: Temporal.PlainDateTime): Temporal.PlainDateTime {
  return value;
}

export function toRecurrenceId(value: Temporal.PlainDateTime, allDay: boolean): string {
  const pad = (segment: number) => String(segment).padStart(2, "0");
  const date = `${value.year}${pad(value.month)}${pad(value.day)}`;
  if (allDay) return date;
  return `${date}T${pad(value.hour)}${pad(value.minute)}${pad(value.second)}`;
}

export function parseRecurrenceId(
  recurrenceId: string,
  allDay: boolean,
  templateStart: Temporal.PlainDateTime,
): Temporal.PlainDateTime | null {
  const dateMatch = /^(\d{4})(\d{2})(\d{2})$/.exec(recurrenceId);
  if (dateMatch) {
    const [, year, month, day] = dateMatch;
    const plainDate = Temporal.PlainDate.from({
      year: Number(year),
      month: Number(month),
      day: Number(day),
    });
    if (allDay) {
      return plainDate.toPlainDateTime({ hour: 0, minute: 0, second: 0 });
    }
    return plainDate.toPlainDateTime({
      hour: templateStart.hour,
      minute: templateStart.minute,
      second: templateStart.second,
      millisecond: templateStart.millisecond,
    });
  }

  const dateTimeMatch = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(recurrenceId);
  if (!dateTimeMatch) return null;
  const [, year, month, day, hour, minute, second] = dateTimeMatch;
  return Temporal.PlainDateTime.from({
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second),
  });
}

export function isDetachedException(event: CalendarEvent): boolean {
  if (event.isException === true) return true;
  if (!event.recurrenceId) return false;
  if (isExcludedOccurrence(event, event.recurrenceId)) return false;
  return !event.data.recurrenceRule;
}

export function isExcludedOccurrence(master: CalendarEvent, recurrenceId: string): boolean {
  return Boolean(master.data.exclusionDates?.has(recurrenceId));
}

export function collectDetachedExceptionKeys(events: CalendarEventsMap): Set<string> {
  const detachedExceptionKeys = new Set<string>();
  for (const [, event] of events) {
    if (event.pendingOp === "deleted") continue;
    if (!event.eventId || !event.recurrenceId) continue;
    detachedExceptionKeys.add(`${event.eventId}::${event.recurrenceId}`);
  }
  return detachedExceptionKeys;
}

export function shiftDateValue(
  value: Temporal.PlainDateTime,
  shift: Temporal.Duration | null,
): Temporal.PlainDateTime {
  if (!shift) return value;
  return value.add(shift);
}

export function resolveEventEnd(
  data: Pick<CalendarEventData, "start"> & CalendarEventTimeSpan,
): Temporal.PlainDateTime {
  if ("end" in data && data.end !== undefined) return data.end;
  return shiftDateValue(data.start, data.duration);
}

export function shiftExclusionDates(
  event: CalendarEvent,
  shift: Temporal.Duration | null,
): Set<string> | undefined {
  const { exclusionDates, start, allDay = false } = event.data;
  if (!exclusionDates?.size) return exclusionDates;
  if (!shift) return exclusionDates;
  const shifted = new Set<string>();
  for (const recurrenceId of exclusionDates) {
    const parsed = parseRecurrenceId(recurrenceId, allDay, start);
    if (!parsed) {
      shifted.add(recurrenceId);
      continue;
    }
    shifted.add(toRecurrenceId(shiftDateValue(parsed, shift), allDay));
  }
  return shifted;
}

export function shiftRecurrenceId(
  recurrenceId: string | undefined,
  allDay: boolean,
  templateStart: Temporal.PlainDateTime,
  shift: Temporal.Duration | null,
): string | undefined {
  if (!recurrenceId || !shift) return recurrenceId;
  const parsed = parseRecurrenceId(recurrenceId, allDay, templateStart);
  if (!parsed) return recurrenceId;
  return toRecurrenceId(shiftDateValue(parsed, shift), allDay);
}
