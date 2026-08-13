import type { JmapCalendarEvent } from "@/lib/jmap-client";
import type { CalendarEventPatch } from "@/calendar-core/src/calendar-types";
import { patchToJmapPartial } from "@/calendar-core/src/calendar-wire";

/** Later fields win per key — same last-write-wins coalescing as tasks/contacts. */
export function coalesceCalendarEventPatches(
  earlier: CalendarEventPatch,
  later: CalendarEventPatch,
): CalendarEventPatch {
  return { ...earlier, ...later };
}

/** Optimistic local application of a patch onto the cached wire event. */
export function applyCalendarEventPatch(
  event: JmapCalendarEvent,
  patch: CalendarEventPatch,
): JmapCalendarEvent {
  return { ...event, ...patchToJmapPartial(patch) } as JmapCalendarEvent;
}
