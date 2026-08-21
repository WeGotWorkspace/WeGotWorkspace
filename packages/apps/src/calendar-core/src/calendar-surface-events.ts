import type { CalendarEventsMap } from "@/lib/calendar-engine";
import type { JmapCalendarEvent } from "@/lib/jmap-client";
import {
  applyOwnRsvpToEngineEvents,
  calendarEventsToEngineMap,
} from "@/calendar-core/src/calendar-event-model";

/**
 * How the surface picks events: adapter once ready, empty while an online
 * client is still initializing (stale cache would flash the pre-drag slot),
 * otherwise Dexie/bootstrap cache (offline or adapter init failed).
 */
export type CalendarSurfaceAdapterPhase = "cache" | "loading" | "ready" | "failed";

export function resolveCalendarSurfaceEvents(input: {
  phase: CalendarSurfaceAdapterPhase;
  adapterEvents?: CalendarEventsMap;
  cacheEvents: readonly JmapCalendarEvent[];
  sessionEmail?: string;
}): CalendarEventsMap {
  const cache = [...input.cacheEvents];
  if (input.phase === "ready" && input.adapterEvents) {
    return applyOwnRsvpToEngineEvents(new Map(input.adapterEvents), cache, input.sessionEmail);
  }
  if (input.phase === "ready" || input.phase === "loading") {
    return applyOwnRsvpToEngineEvents(new Map(), cache, input.sessionEmail);
  }
  return applyOwnRsvpToEngineEvents(calendarEventsToEngineMap(cache), cache, input.sessionEmail);
}
