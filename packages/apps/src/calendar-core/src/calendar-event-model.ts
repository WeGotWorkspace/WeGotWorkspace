import { Temporal } from "@js-temporal/polyfill";
import { expandEvents, type CalendarEvent, type CalendarEventsMap } from "@/lib/calendar-engine";
import { jmapEventToInternalRows, type JmapCalendarEvent } from "@/lib/jmap-client";
import type { JmapParticipant } from "@/calendar-core/src/calendar-attendees";
import { ownEventRsvpPresentation } from "@/calendar-core/src/calendar-attendees";
import type { CalendarInfo, CalendarViewId } from "@/calendar-core/src/calendar-types";

/**
 * Pure bridge between the JSCalendar wire shape the app stores/syncs and the
 * calendar-engine's Temporal model the views render. No React, no IO.
 */

export type CalendarOccurrence = {
  /** Engine row key — unique per rendered occurrence. */
  key: string;
  /** The wire event id this occurrence belongs to (master id for recurrences). */
  eventId: string;
  calendarId: string;
  title: string;
  color: string;
  allDay: boolean;
  isRecurring: boolean;
  start: Temporal.PlainDateTime;
  end: Temporal.PlainDateTime;
  location?: string;
};

function wireParticipants(event: JmapCalendarEvent): Record<string, JmapParticipant> | undefined {
  const raw = event.participants;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  return raw as Record<string, JmapParticipant>;
}

export function applyOwnRsvpToEngineEvents(
  events: CalendarEventsMap,
  wireEvents: readonly JmapCalendarEvent[],
  sessionEmail?: string,
): CalendarEventsMap {
  const byId = new Map<string, ReturnType<typeof ownEventRsvpPresentation>>();
  const byUid = new Map<string, ReturnType<typeof ownEventRsvpPresentation>>();
  for (const wire of wireEvents) {
    const status = ownEventRsvpPresentation(wireParticipants(wire), sessionEmail);
    byId.set(wire.id, status);
    if (wire.uid) byUid.set(wire.uid, status);
  }

  const next: CalendarEventsMap = new Map();
  for (const [key, event] of events) {
    const masterKey = key.includes("::") ? key.slice(0, key.indexOf("::")) : key;
    const status = byId.get(masterKey) ?? (event.eventId ? byUid.get(event.eventId) : undefined);
    if (status === "declined") continue;
    next.set(key, status ? { ...event, participationStatus: status } : event);
  }
  return next;
}

export function calendarEventsToEngineMap(
  events: JmapCalendarEvent[],
  options: { sessionEmail?: string } = {},
): CalendarEventsMap {
  const map: CalendarEventsMap = new Map();
  for (const event of events) {
    for (const row of jmapEventToInternalRows(event)) {
      map.set(row.key, row.event);
    }
  }
  return applyOwnRsvpToEngineEvents(map, events, options.sessionEmail);
}

function resolveEnd(event: CalendarEvent): Temporal.PlainDateTime {
  const duration = event.data.duration ?? new Temporal.Duration();
  return event.data.start.add(duration);
}

/** The engine keys detached exceptions as `${masterKey}::${recurrenceId}`. */
function masterKeyOf(rowKey: string): string {
  const separator = rowKey.indexOf("::");
  return separator === -1 ? rowKey : rowKey.slice(0, separator);
}

export function occurrencesInRange(
  events: JmapCalendarEvent[],
  range: { start: string; end: string },
  options: { calendars?: CalendarInfo[]; visibleCalendarIds?: ReadonlySet<string> } = {},
): CalendarOccurrence[] {
  const colorByCalendar = new Map<string, string>();
  for (const calendar of options.calendars ?? []) {
    colorByCalendar.set(calendar.id, calendar.color);
  }

  const expanded = expandEvents(calendarEventsToEngineMap(events), {
    start: Temporal.PlainDateTime.from(range.start),
    end: Temporal.PlainDateTime.from(range.end),
  });

  const occurrences: CalendarOccurrence[] = [];
  for (const [key, event] of expanded) {
    const calendarId = event.calendarId ?? "";
    if (options.visibleCalendarIds && !options.visibleCalendarIds.has(calendarId)) {
      continue;
    }
    occurrences.push({
      key,
      eventId: masterKeyOf(key),
      calendarId,
      title: event.data.summary,
      color: event.data.color ?? colorByCalendar.get(calendarId) ?? "#6366F1",
      allDay: event.data.allDay === true,
      isRecurring: event.isRecurring === true,
      start: event.data.start,
      end: resolveEnd(event),
      ...(event.data.location ? { location: event.data.location } : {}),
    });
  }

  occurrences.sort((a, b) => {
    const byStart = Temporal.PlainDateTime.compare(a.start, b.start);
    if (byStart !== 0) return byStart;
    return a.title.localeCompare(b.title);
  });
  return occurrences;
}

/** ISO date (YYYY-MM-DD) for "today" in the runtime's local time zone. */
export function todayISODate(): string {
  return Temporal.Now.plainDateISO().toString();
}

export type CalendarDateRange = {
  /** Inclusive first rendered date. */
  start: Temporal.PlainDate;
  /** Exclusive end date. */
  end: Temporal.PlainDate;
};

/**
 * Rendered date range for a view anchored at `anchor` (ISO date). Month covers
 * full weeks around the month (Monday start).
 */
export function viewDateRange(view: CalendarViewId, anchorISO: string): CalendarDateRange {
  const anchor = Temporal.PlainDate.from(anchorISO);
  switch (view) {
    case "day":
      return { start: anchor, end: anchor.add({ days: 1 }) };
    case "week": {
      const start = anchor.subtract({ days: anchor.dayOfWeek - 1 });
      return { start, end: start.add({ days: 7 }) };
    }
    case "year": {
      const first = anchor.with({ month: 1, day: 1 });
      return { start: first, end: first.add({ years: 1 }) };
    }
    case "month": {
      const first = anchor.with({ day: 1 });
      const gridStart = first.subtract({ days: first.dayOfWeek - 1 });
      const last = first.add({ months: 1 });
      const trailing = last.dayOfWeek === 1 ? 0 : 8 - last.dayOfWeek;
      return { start: gridStart, end: last.add({ days: trailing }) };
    }
  }
}

export function shiftAnchor(view: CalendarViewId, anchorISO: string, direction: 1 | -1): string {
  const anchor = Temporal.PlainDate.from(anchorISO);
  switch (view) {
    case "day":
      return anchor.add({ days: direction }).toString();
    case "week":
      return anchor.add({ days: 7 * direction }).toString();
    case "month":
      return anchor.add({ months: direction }).with({ day: 1 }).toString();
    case "year":
      return anchor.add({ years: direction }).with({ month: 1, day: 1 }).toString();
  }
}

export function rangeToPlainDateTimeStrings(range: CalendarDateRange): {
  start: string;
  end: string;
} {
  return { start: `${range.start.toString()}T00:00:00`, end: `${range.end.toString()}T00:00:00` };
}
