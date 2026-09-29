import { Temporal } from "@js-temporal/polyfill";
import { isTaskDueOverlayEvent } from "@/calendar-core/src/calendar-task-due-overlay";
import type { CalendarEvent as ApiCalendarEvent } from "@/lib/calendar-engine";
import {
  isCalendarEventException,
  isCalendarEventRecurring,
} from "../types/calendarEventSemantics.js";
import type { TimelineEvent } from "../types/TimeLine.js";
import { resolvedDataEnd } from "../domain/events-api/eventMapBridge.js";
import { eventOccurrenceInDisplayZone } from "../utils/event-display-time.js";
import {
  toTimelineAllDayRange,
  toTimelineRange,
  type CalendarTimelineScale,
} from "./CalendarTimelineScale.js";
import {
  occurrenceTimesWithPending,
  type PendingOccurrenceGeometry,
} from "./pendingOccurrenceGeometry.js";

export type TimelineVariant = "timed" | "all-day";

export type CalendarTimelineEvent = TimelineEvent & {
  key: string;
  summary: string;
  color: string;
  location: string;
  originalStart: Temporal.PlainDateTime;
  originalEnd: Temporal.PlainDateTime;
  timeZone?: string;
  allDay: boolean;
  past: boolean;
  recurring: boolean;
  exception: boolean;
  rsvp: "" | "needs-action" | "tentative";
  locked?: boolean;
  overlayKind?: "task";
};

export function mapTimelineOccurrenceEvents(
  entries: [string, ApiCalendarEvent][],
  variant: TimelineVariant,
  args: {
    now: Temporal.PlainDateTime;
    pending: PendingOccurrenceGeometry | null;
    scale: CalendarTimelineScale;
    displayTimeZone: string;
    resolveColor: (event: ApiCalendarEvent) => string;
  },
): CalendarTimelineEvent[] {
  return entries.map(([key, event]) => {
    const engineStart = event.data.start;
    const engineEnd = resolvedDataEnd(event.data);
    const { start: originalStart, end: originalEnd } = occurrenceTimesWithPending(
      key,
      { start: engineStart, end: engineEnd },
      args.pending,
    );
    const displayStart = eventOccurrenceInDisplayZone(
      originalStart,
      event.data,
      args.displayTimeZone,
    );
    const displayEnd = eventOccurrenceInDisplayZone(originalEnd, event.data, args.displayTimeZone);
    const range =
      variant === "all-day"
        ? toTimelineAllDayRange(displayStart, displayEnd, args.scale)
        : toTimelineRange(displayStart, displayEnd, args.scale);
    return {
      key,
      start: range.start,
      end: range.end,
      location: event.data.location ?? "",
      summary: event.data.summary,
      color: args.resolveColor(event),
      originalStart,
      originalEnd,
      timeZone: event.data.timeZone,
      allDay: event.data.allDay === true,
      past: Temporal.PlainDateTime.compare(displayEnd, args.now) <= 0,
      recurring: isCalendarEventRecurring(event),
      exception: isCalendarEventException(event),
      rsvp:
        event.participationStatus === "needs-action" || event.participationStatus === "tentative"
          ? event.participationStatus
          : "",
      locked: isTaskDueOverlayEvent(event),
      overlayKind: event.overlayKind === "task" ? "task" : undefined,
    };
  });
}
