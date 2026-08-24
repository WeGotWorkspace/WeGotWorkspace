import { Temporal } from "@js-temporal/polyfill";
import { expandEvents, type CalendarEventsMap } from "@/lib/calendar-engine";

const EMPTY_EVENTS: CalendarEventsMap = new Map();
const RENDERED_EVENTS_LRU_LIMIT = 8;

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
  entries: Map<string, CalendarEventsMap>;
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

function rangeKey(range: RenderedEventsRange): string {
  return `${range.start.toString()}|${range.end.toString()}`;
}

function rememberEntry(
  entries: Map<string, CalendarEventsMap>,
  key: string,
  value: CalendarEventsMap,
): void {
  entries.delete(key);
  entries.set(key, value);
  while (entries.size > RENDERED_EVENTS_LRU_LIMIT) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
}

function cacheWithCurrent(
  events: CalendarEventsMap | undefined,
  timezone: string,
  range: RenderedEventsRange,
  value: CalendarEventsMap,
  entries: Map<string, CalendarEventsMap>,
): RenderedEventsCache {
  const start = range.start.toString();
  const end = range.end.toString();
  rememberEntry(entries, rangeKey(range), value);
  return { events, timezone, start, end, value, entries };
}

export function adjacentRenderedEventRanges(range: RenderedEventsRange): {
  prev: RenderedEventsRange;
  next: RenderedEventsRange;
} {
  const duration = range.start.until(range.end);
  return {
    prev: { start: range.start.subtract(duration), end: range.start },
    next: { start: range.end, end: range.end.add(duration) },
  };
}

export function cachedVisibleEventsInRange(
  cache: RenderedEventsCache | null,
  events: CalendarEventsMap | undefined,
  range: RenderedEventsRange,
  timezone: string,
): { value: CalendarEventsMap; cache: RenderedEventsCache } {
  const key = rangeKey(range);
  const reusable =
    cache && cache.events === events && cache.timezone === timezone ? cache.entries : new Map();
  const hit = reusable.get(key);
  if (hit) {
    return { value: hit, cache: cacheWithCurrent(events, timezone, range, hit, reusable) };
  }
  const value = visibleEventsInRange(events, range, timezone);
  return { value, cache: cacheWithCurrent(events, timezone, range, value, reusable) };
}

export function prefetchVisibleEventsInRange(
  cache: RenderedEventsCache | null,
  events: CalendarEventsMap | undefined,
  range: RenderedEventsRange,
  timezone: string,
): RenderedEventsCache {
  if (cache && (cache.events !== events || cache.timezone !== timezone)) {
    return cache;
  }
  const key = rangeKey(range);
  if (cache?.entries.has(key)) return cache;
  return cachedVisibleEventsInRange(cache, events, range, timezone).cache;
}
