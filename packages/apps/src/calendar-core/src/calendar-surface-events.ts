import type { CalendarEventsMap } from "@/lib/calendar-engine";
import type { JmapCalendarEvent } from "@/lib/jmap-client";
import {
  applyOwnRsvpToEngineEvents,
  calendarEventsToEngineMap,
} from "@/calendar-core/src/calendar-event-model";
import type { CalendarInfo } from "@/calendar-core/src/calendar-types";
import {
  alignOfflineEventIds,
  mergeOfflineCacheEvents,
  omitPendingDeletedEvents,
} from "@/calendar-core/src/calendar-events-api";

/**
 * Paint path: working set merged with Dexie/bootstrap cache. Pending move/slot
 * wins over a stale cache. Never reads `JmapEventsAdapter.getEvents()`.
 */
export function resolveCalendarSurfaceEvents(input: {
  workingSet?: CalendarEventsMap;
  cacheEvents: readonly JmapCalendarEvent[];
  calendars?: readonly CalendarInfo[];
  sessionEmail?: string;
}): CalendarEventsMap {
  const cache = [...input.cacheEvents];
  const cacheMap = calendarEventsToEngineMap(cache, { calendars: input.calendars });
  const merged = omitPendingDeletedEvents(
    alignOfflineEventIds(mergeOfflineCacheEvents(input.workingSet, cacheMap)),
  );
  return applyOwnRsvpToEngineEvents(merged, cache, input.sessionEmail);
}
