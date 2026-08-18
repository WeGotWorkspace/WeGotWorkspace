import type { JmapCalendarEvent, JSCalendarPatchObject } from "@/lib/jmap-client";
import type { CalendarEventPatch } from "@/calendar-core/src/calendar-types";
import { patchToJmapPartial } from "@/calendar-core/src/calendar-wire";

/** Later fields win per key — same last-write-wins coalescing as tasks/contacts. */
export function coalesceCalendarEventPatches(
  earlier: CalendarEventPatch,
  later: CalendarEventPatch,
): CalendarEventPatch {
  return { ...earlier, ...later };
}

/**
 * Apply a recurrenceOverrides patch with JMAP remove-null semantics: `null` clears
 * the whole map; a key mapped to `null` deletes that override.
 */
export function mergeRecurrenceOverridesPatch(
  existing: JmapCalendarEvent["recurrenceOverrides"] | undefined,
  patch: Record<string, JSCalendarPatchObject | null> | null,
): JmapCalendarEvent["recurrenceOverrides"] {
  if (patch === null) return null;
  const next: Record<string, JSCalendarPatchObject> = { ...(existing ?? {}) };
  for (const [rid, value] of Object.entries(patch)) {
    if (value === null) delete next[rid];
    else next[rid] = value;
  }
  return Object.keys(next).length ? next : null;
}

/** Optimistic local application of a patch onto the cached wire event. */
export function applyCalendarEventPatch(
  event: JmapCalendarEvent,
  patch: CalendarEventPatch,
): JmapCalendarEvent {
  const partial = patchToJmapPartial(patch);
  const next = { ...event, ...partial } as JmapCalendarEvent;
  if (patch.recurrenceOverrides !== undefined) {
    next.recurrenceOverrides = mergeRecurrenceOverridesPatch(
      event.recurrenceOverrides,
      patch.recurrenceOverrides,
    );
  }
  return next;
}
