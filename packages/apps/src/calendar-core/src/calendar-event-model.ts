import { Temporal } from "@js-temporal/polyfill";
import { expandEvents, type CalendarEvent, type CalendarEventsMap } from "@/lib/calendar-engine";
import { jmapEventToInternalRows, type JmapCalendarEvent } from "@/lib/jmap-client";
import { localToInternalRecurrenceId } from "@/lib/jmap-client/mapping/datetime";
import type { JmapParticipant } from "@/calendar-core/src/calendar-attendees";
import {
  ownEventRsvpPresentation,
  type CalendarParticipationStatus,
} from "@/calendar-core/src/calendar-attendees";
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

/**
 * Series decline on the master hides every instance unless a later this-instance
 * RSVP (accepted / tentative) overrides it. Stale NEEDS-ACTION exception patches
 * and unmatched RECURRENCE-ID keys inherit declined.
 */
function effectiveOwnRsvp(
  masterStatus: CalendarParticipationStatus | null | undefined,
  occurrenceStatus: CalendarParticipationStatus | null | undefined,
): CalendarParticipationStatus | null | undefined {
  if (masterStatus === "declined") {
    if (occurrenceStatus === "accepted" || occurrenceStatus === "tentative") {
      return occurrenceStatus;
    }
    return "declined";
  }
  return occurrenceStatus !== undefined ? occurrenceStatus : masterStatus;
}

function overrideRsvpByRecurrenceId(
  wire: JmapCalendarEvent,
  sessionEmail?: string,
): Map<string, CalendarParticipationStatus | null> {
  const map = new Map<string, CalendarParticipationStatus | null>();
  const overrides = wire.recurrenceOverrides;
  if (!overrides) return map;
  const allDay = wire.showWithoutTime === true;
  for (const [rid, patch] of Object.entries(overrides)) {
    if (!patch || typeof patch !== "object") continue;
    const rawParticipants = (patch as { participants?: unknown }).participants;
    const participants =
      rawParticipants && typeof rawParticipants === "object" && !Array.isArray(rawParticipants)
        ? (rawParticipants as Record<string, JmapParticipant>)
        : undefined;
    const status = ownEventRsvpPresentation(participants ?? wireParticipants(wire), sessionEmail);
    map.set(rid, status);
    map.set(rid.replace(/Z$/, ""), status);
    try {
      map.set(localToInternalRecurrenceId(rid.replace(/Z$/, ""), allDay), status);
    } catch {
      // Compact lookup is best-effort — the local key still matches wire overrides.
    }
  }
  return map;
}

export function applyOwnRsvpToEngineEvents(
  events: CalendarEventsMap,
  wireEvents: readonly JmapCalendarEvent[],
  sessionEmail?: string,
): CalendarEventsMap {
  const byId = new Map<string, CalendarParticipationStatus | null>();
  const byUid = new Map<string, CalendarParticipationStatus | null>();
  const overridesById = new Map<string, Map<string, CalendarParticipationStatus | null>>();
  const overridesByUid = new Map<string, Map<string, CalendarParticipationStatus | null>>();
  for (const wire of wireEvents) {
    const status = ownEventRsvpPresentation(wireParticipants(wire), sessionEmail);
    byId.set(wire.id, status);
    if (wire.uid) byUid.set(wire.uid, status);
    const overrides = overrideRsvpByRecurrenceId(wire, sessionEmail);
    if (overrides.size) {
      overridesById.set(wire.id, overrides);
      if (wire.uid) overridesByUid.set(wire.uid, overrides);
    }
  }

  const next: CalendarEventsMap = new Map();
  for (const [key, event] of events) {
    const masterKey = key.includes("::") ? key.slice(0, key.indexOf("::")) : key;
    const occurrenceId = key.includes("::") ? key.slice(key.indexOf("::") + 2) : event.recurrenceId;
    const overrides =
      overridesById.get(masterKey) ??
      (event.eventId ? overridesByUid.get(event.eventId) : undefined);
    const occurrenceStatus = occurrenceId
      ? (overrides?.get(occurrenceId) ?? overrides?.get(occurrenceId.replace(/Z$/, "")))
      : undefined;
    const masterStatus =
      byId.get(masterKey) ?? (event.eventId ? byUid.get(event.eventId) : undefined);
    const status = effectiveOwnRsvp(masterStatus, occurrenceStatus);
    const isOccurrence = Boolean(occurrenceId);
    const isRecurringMaster = event.isRecurring === true && !isOccurrence;
    if (status === "declined" && !isOccurrence && !isRecurringMaster) continue;
    next.set(key, status ? { ...event, participationStatus: status } : event);
  }
  return next;
}

/**
 * Join each calendar collection color onto engine events that have no override.
 * Lit chips read `event.data.color` first; offline there is no EventsAPI map.
 */
export function applyCalendarColorsToEngineEvents(
  events: CalendarEventsMap,
  calendars: readonly CalendarInfo[],
): CalendarEventsMap {
  if (calendars.length === 0) return events;
  const colorByCalendar = new Map<string, string>();
  for (const calendar of calendars) {
    if (calendar.color) colorByCalendar.set(calendar.id, calendar.color);
  }
  if (colorByCalendar.size === 0) return events;

  const next: CalendarEventsMap = new Map();
  for (const [key, event] of events) {
    const override = event.data.color;
    if (override) {
      next.set(key, event);
      continue;
    }
    const calendarColor = event.calendarId ? colorByCalendar.get(event.calendarId) : undefined;
    next.set(
      key,
      calendarColor ? { ...event, data: { ...event.data, color: calendarColor } } : event,
    );
  }
  return next;
}

export function calendarEventsToEngineMap(
  events: JmapCalendarEvent[],
  options: { sessionEmail?: string; calendars?: readonly CalendarInfo[] } = {},
): CalendarEventsMap {
  const map: CalendarEventsMap = new Map();
  for (const event of events) {
    try {
      for (const row of jmapEventToInternalRows(event)) {
        map.set(row.key, row.event);
      }
    } catch (error) {
      // One corrupt wire event must not take down CalendarApp.
      console.warn("[calendar] skipped unmappable event", event.id ?? event.uid, error);
    }
  }
  const withRsvp = applyOwnRsvpToEngineEvents(map, events, options.sessionEmail);
  return applyCalendarColorsToEngineEvents(withRsvp, options.calendars ?? []);
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
  options: {
    calendars?: CalendarInfo[];
    visibleCalendarIds?: ReadonlySet<string>;
    sessionEmail?: string;
  } = {},
): CalendarOccurrence[] {
  const colorByCalendar = new Map<string, string>();
  for (const calendar of options.calendars ?? []) {
    colorByCalendar.set(calendar.id, calendar.color);
  }

  const expanded = expandEvents(
    calendarEventsToEngineMap(events, { sessionEmail: options.sessionEmail }),
    {
      start: Temporal.PlainDateTime.from(range.start),
      end: Temporal.PlainDateTime.from(range.end),
    },
  );

  const occurrences: CalendarOccurrence[] = [];
  for (const [key, event] of expanded) {
    if (event.participationStatus === "declined") continue;
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

/** True when this view's rendered period is the same as navigating to today. */
export function isViewShowingToday(
  view: CalendarViewId,
  anchorISO: string,
  todayISO: string = todayISODate(),
): boolean {
  const current = viewDateRange(view, anchorISO);
  const todayRange = viewDateRange(view, todayISO);
  return (
    Temporal.PlainDate.compare(current.start, todayRange.start) === 0 &&
    Temporal.PlainDate.compare(current.end, todayRange.end) === 0
  );
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
