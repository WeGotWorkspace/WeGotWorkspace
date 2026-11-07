import type { CalendarEvent } from "@/lib/calendar-engine";
import {
  isAvailabilityOverlayEvent,
  parseAvailabilityOverlayKey,
} from "@/calendar-core/src/calendar-availability-overlay";
import {
  isTaskDueOverlayEvent,
  isTaskDueOverlayKey,
} from "@/calendar-core/src/calendar-task-due-overlay";

/**
 * Render-only rows on the grid: Tasks due markers and teammates' busy blocks.
 * They never go through EventsAPI or Calendar JMAP, so drag, resize, delete
 * and edit stop here.
 */
export function isRenderOnlyOverlayKey(key: string | undefined | null): boolean {
  return isTaskDueOverlayKey(key) || parseAvailabilityOverlayKey(key) !== null;
}

export function isRenderOnlyOverlayEvent(
  event: Pick<CalendarEvent, "overlayKind" | "eventId" | "calendarId"> | undefined | null,
): boolean {
  return isTaskDueOverlayEvent(event) || isAvailabilityOverlayEvent(event);
}
