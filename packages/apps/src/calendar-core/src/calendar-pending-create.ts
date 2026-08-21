import type { CalendarEventsMap } from "@/lib/calendar-engine";
import { resolvedDataEnd } from "@/lib/calendar-elements/domain/events-api/eventMapBridge";
import { pendingCreateRetention } from "@/lib/calendar-elements/CalendarTimelineView/pendingOccurrenceGeometry";
import {
  formToCreateIntent,
  type CalendarEventFormValue,
} from "@/calendar-core/src/calendar-editor-model";
import type { CalendarSurfaceCreateIntent } from "@/calendar-core/src/calendar-surface";

/**
 * Create-preview for the open dialog, or the last saved create until a matching
 * occurrence is on the surface. Lit already paints this card — do not add a
 * second engine row for the same slot.
 */
export function resolvePendingCreateIntent(
  editor: { mode: string; form: CalendarEventFormValue } | null,
  held: CalendarSurfaceCreateIntent | null,
  surfaceEvents?: CalendarEventsMap,
): CalendarSurfaceCreateIntent | null {
  if (editor?.mode === "create") return formToCreateIntent(editor.form);
  if (!held) return null;
  if (surfaceEvents && shouldClearHeldCreateIntent(held, surfaceEvents)) return null;
  return held;
}

export function shouldClearHeldCreateIntent(
  held: CalendarSurfaceCreateIntent,
  surfaceEvents: CalendarEventsMap,
): boolean {
  const engineEvents = [...surfaceEvents.values()].map((event) => ({
    start: event.data.start,
    end: resolvedDataEnd(event.data),
    allDay: event.data.allDay === true,
  }));
  return pendingCreateRetention(held, engineEvents) === "clear";
}
