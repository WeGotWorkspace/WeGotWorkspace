import { Temporal } from "@js-temporal/polyfill";
import { calendarBootstrapWindow } from "@/lib/api/wgw/calendar";
import type { CalendarEventsMap } from "@/lib/calendar-engine";
import type { JmapCalendarEvent } from "@/lib/jmap-client";
import {
  occurrencesInRange,
  type CalendarOccurrence,
} from "@/calendar-core/src/calendar-event-model";
import type { CalendarInfo } from "@/calendar-core/src/calendar-types";

/** Independent per-section cap. Recurring series can produce many rows. */
export const CALENDAR_SEARCH_SECTION_CAP = 100;

export type CalendarSearchResults = {
  upcoming: CalendarOccurrence[];
  past: CalendarOccurrence[];
  truncatedUpcoming: boolean;
  truncatedPast: boolean;
};

/** Stable empty result for idle browse — callers may reuse this identity. */
export const EMPTY_SEARCH_RESULTS: CalendarSearchResults = {
  upcoming: [],
  past: [],
  truncatedUpcoming: false,
  truncatedPast: false,
};

export type CalendarSearchDateRange = { start: string; end: string };

/**
 * Convert the Dexie/JMAP bootstrap window into the PlainDateTime range
 * `occurrencesInRange` expects. Do not fetch a wider JMAP window.
 */
export function calendarSearchRange(
  today: Temporal.PlainDate = Temporal.Now.plainDateISO(),
): CalendarSearchDateRange {
  const { utcStart, utcEnd } = calendarBootstrapWindow(today);
  return {
    start: utcDateToPlainDateTimeString(utcStart),
    end: utcDateToPlainDateTimeString(utcEnd),
  };
}

/**
 * Bootstrap corpus plus the on-screen period. Week/month navigation can sit
 * outside `calendarBootstrapWindow()` (Storybook 2033 seed, or a far jump)
 * while those events are already in `data.events`.
 */
export function unionCalendarSearchRange(
  today?: Temporal.PlainDate,
  visibleRange?: CalendarSearchDateRange,
): CalendarSearchDateRange {
  const bootstrap = calendarSearchRange(today);
  if (!visibleRange) return bootstrap;
  return {
    start: minDateTimeString(bootstrap.start, visibleRange.start),
    end: maxDateTimeString(bootstrap.end, visibleRange.end),
  };
}

function utcDateToPlainDateTimeString(date: Date): string {
  return date
    .toISOString()
    .replace(/\.\d{3}Z$/, "")
    .replace(/Z$/, "");
}

export function expandSearchOccurrences(
  events: readonly JmapCalendarEvent[],
  options: {
    calendars?: readonly CalendarInfo[];
    visibleCalendarIds?: ReadonlySet<string>;
    today?: Temporal.PlainDate;
    visibleRange?: CalendarSearchDateRange;
  } = {},
): CalendarOccurrence[] {
  return occurrencesInRange(
    [...events],
    unionCalendarSearchRange(options.today, options.visibleRange),
    {
      calendars: options.calendars ? [...options.calendars] : undefined,
      visibleCalendarIds: options.visibleCalendarIds,
    },
  );
}

export function matchCalendarOccurrences(
  occurrences: readonly CalendarOccurrence[],
  events: readonly JmapCalendarEvent[],
  query: string,
  now: Temporal.PlainDateTime = Temporal.Now.plainDateTimeISO(),
): CalendarSearchResults {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return EMPTY_SEARCH_RESULTS;
  }

  const descriptionByEventId = new Map<string, string>();
  const locationsByEventId = new Map<string, string>();
  for (const event of events) {
    if (event.description) {
      descriptionByEventId.set(event.id, event.description);
    }
    const joined = joinWireLocationNames(event);
    if (joined) {
      locationsByEventId.set(event.id, joined);
    }
  }

  const upcoming: CalendarOccurrence[] = [];
  const past: CalendarOccurrence[] = [];
  for (const occurrence of occurrences) {
    if (!occurrenceMatches(occurrence, needle, descriptionByEventId, locationsByEventId)) {
      continue;
    }
    if (Temporal.PlainDateTime.compare(occurrence.end, now) > 0) {
      upcoming.push(occurrence);
    } else {
      past.push(occurrence);
    }
  }

  upcoming.sort((a, b) => Temporal.PlainDateTime.compare(a.start, b.start));
  past.sort((a, b) => Temporal.PlainDateTime.compare(b.start, a.start));

  const truncatedUpcoming = upcoming.length > CALENDAR_SEARCH_SECTION_CAP;
  const truncatedPast = past.length > CALENDAR_SEARCH_SECTION_CAP;
  return {
    upcoming: upcoming.slice(0, CALENDAR_SEARCH_SECTION_CAP),
    past: past.slice(0, CALENDAR_SEARCH_SECTION_CAP),
    truncatedUpcoming,
    truncatedPast,
  };
}

export function searchCalendarEvents(
  events: readonly JmapCalendarEvent[],
  query: string,
  options: {
    calendars?: readonly CalendarInfo[];
    visibleCalendarIds?: ReadonlySet<string>;
    today?: Temporal.PlainDate;
    now?: Temporal.PlainDateTime;
    visibleRange?: CalendarSearchDateRange;
  } = {},
): CalendarSearchResults {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return EMPTY_SEARCH_RESULTS;
  }
  const candidates = events.filter((event) => masterMightMatch(event, needle));
  const occurrences = expandSearchOccurrences(candidates, {
    calendars: options.calendars,
    visibleCalendarIds: options.visibleCalendarIds,
    today: options.today,
    visibleRange: options.visibleRange,
  });
  return matchCalendarOccurrences(occurrences, events, query, options.now);
}

function masterMightMatch(event: JmapCalendarEvent, needle: string): boolean {
  if (includesExactSubstring(event.title, needle)) return true;
  if (includesExactSubstring(event.description, needle)) return true;
  if (includesExactSubstring(joinWireLocationNames(event), needle)) return true;
  const overrides = event.recurrenceOverrides;
  if (!overrides) return false;
  for (const patch of Object.values(overrides)) {
    if (!patch || typeof patch !== "object") continue;
    if (overrideMightMatch(patch, needle)) return true;
  }
  return false;
}

/**
 * Prefilter must keep masters whose only hit is a this-instance title or
 * location patch. Description overrides stay a documented non-goal.
 */
function overrideMightMatch(patch: object, needle: string): boolean {
  const record = patch as { title?: unknown };
  if (typeof record.title === "string" && includesExactSubstring(record.title, needle)) {
    return true;
  }
  return includesExactSubstring(joinOverrideLocationNames(patch), needle);
}

function occurrenceMatches(
  occurrence: CalendarOccurrence,
  needle: string,
  descriptionByEventId: ReadonlyMap<string, string>,
  locationsByEventId: ReadonlyMap<string, string>,
): boolean {
  const title = occurrence.title;
  const location = occurrence.location || locationsByEventId.get(occurrence.eventId) || "";
  const description = descriptionByEventId.get(occurrence.eventId) ?? "";
  return (
    includesExactSubstring(title, needle) ||
    includesExactSubstring(location, needle) ||
    includesExactSubstring(description, needle)
  );
}

function includesExactSubstring(haystack: string | undefined, needle: string): boolean {
  return (haystack ?? "").toLowerCase().includes(needle);
}

function minDateTimeString(left: string, right: string): string {
  return left <= right ? left : right;
}

function maxDateTimeString(left: string, right: string): string {
  return left >= right ? left : right;
}

/**
 * One chronological agenda: the capped past window oldest→newest, then upcoming.
 * Matcher still keeps past newest-first so the 100-cap is “most recent”.
 */
export function unifiedSearchOccurrences(results: CalendarSearchResults): CalendarOccurrence[] {
  return [...results.past].reverse().concat(results.upcoming);
}

/** Already-expanded instances for `calendar-list-view use-event-set`. */
export function searchOccurrencesToEngineMap(
  occurrences: readonly CalendarOccurrence[],
): CalendarEventsMap {
  const map: CalendarEventsMap = new Map();
  for (const occurrence of occurrences) {
    map.set(occurrence.key, {
      calendarId: occurrence.calendarId,
      eventId: occurrence.eventId,
      isRecurring: occurrence.isRecurring,
      data: {
        start: occurrence.start,
        end: occurrence.end,
        allDay: occurrence.allDay,
        summary: occurrence.title,
        color: occurrence.color,
        ...(occurrence.location ? { location: occurrence.location } : {}),
      },
    });
  }
  return map;
}

function joinWireLocationNames(event: JmapCalendarEvent): string {
  return joinLocationNames(event.locations);
}

function joinOverrideLocationNames(patch: object): string {
  const record = patch as Record<string, unknown>;
  const fromMap = joinLocationNames(record.locations);
  if (fromMap) return fromMap;
  return Object.entries(record)
    .filter(([key, value]) => /^locations\/[^/]+\/name$/.test(key) && typeof value === "string")
    .map(([, value]) => (value as string).trim())
    .filter(Boolean)
    .join(" ");
}

function joinLocationNames(locations: JmapCalendarEvent["locations"] | unknown): string {
  if (!locations || typeof locations !== "object" || Array.isArray(locations)) return "";
  return Object.values(locations as Record<string, { name?: string } | null | undefined>)
    .map((location) => location?.name?.trim() ?? "")
    .filter(Boolean)
    .join(" ");
}
