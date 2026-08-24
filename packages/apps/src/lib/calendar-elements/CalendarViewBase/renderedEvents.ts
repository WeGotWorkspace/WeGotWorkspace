import { Temporal } from "@js-temporal/polyfill";
import { expandEvents, type CalendarEventsMap } from "@/lib/calendar-engine";

const EMPTY_EVENTS: CalendarEventsMap = new Map();

export type RenderedEventsRange = {
  start: Temporal.PlainDateTime;
  end: Temporal.PlainDateTime;
};

export type RenderedEventsCache = {
  events: CalendarEventsMap | undefined;
  timezone: string;
  start: string;
  end: string;
  value: CalendarEventsMap;
};

export function visibleEventsInRange(
  events: CalendarEventsMap | undefined,
  range: RenderedEventsRange,
  timezone: string,
): CalendarEventsMap {
  const expanded = expandEvents(events ?? EMPTY_EVENTS, range, { timezone });
  const visible: CalendarEventsMap = new Map();
  for (const [key, event] of expanded) {
    if (event.participationStatus === "declined") continue;
    visible.set(key, event);
  }
  return visible;
}

export function cachedVisibleEventsInRange(
  cache: RenderedEventsCache | null,
  events: CalendarEventsMap | undefined,
  range: RenderedEventsRange,
  timezone: string,
): { value: CalendarEventsMap; cache: RenderedEventsCache } {
  const start = range.start.toString();
  const end = range.end.toString();
  if (
    cache &&
    cache.events === events &&
    cache.timezone === timezone &&
    cache.start === start &&
    cache.end === end
  ) {
    return { value: cache.value, cache };
  }
  const value = visibleEventsInRange(events, range, timezone);
  return { value, cache: { events, timezone, start, end, value } };
}
