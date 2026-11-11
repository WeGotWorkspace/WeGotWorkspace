import { Temporal } from "@js-temporal/polyfill";
import { isRenderOnlyOverlayEvent } from "@/calendar-core/src/calendar-render-overlay";
import type { CalendarEvent as ApiCalendarEvent } from "@/lib/calendar-engine";
import {
  isCalendarEventException,
  isCalendarEventRecurring,
} from "../types/calendarEventSemantics.js";
import type { DayOverflowPopoverEvent } from "../types/DayOverflowPopover.js";
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
  displayStart: Temporal.PlainDateTime;
  displayEnd: Temporal.PlainDateTime;
  timeZone?: string;
  allDay: boolean;
  past: boolean;
  recurring: boolean;
  exception: boolean;
  rsvp: "" | "needs-action" | "tentative";
  locked?: boolean;
  overlayKind?: "task" | "availability";
};

/** A year-view day chip: what its day list needs. */
export type YearDayChip = Pick<
  CalendarTimelineEvent,
  "key" | "summary" | "color" | "displayStart" | "displayEnd" | "allDay" | "rsvp" | "overlayKind"
>;

/** Popover payload for a day's events (shared by the overflow footer and compact header). */
export function dayOverflowPopoverEvents(events: YearDayChip[]): DayOverflowPopoverEvent[] {
  return events.map((ev) => ({
    id: ev.key,
    start: ev.allDay ? ev.displayStart.toPlainDate().toString() : ev.displayStart.toString(),
    end: ev.allDay ? ev.displayEnd.toPlainDate().toString() : ev.displayEnd.toString(),
    summary: ev.summary,
    color: ev.color,
    hidden: false,
    rsvp: ev.rsvp,
    overlay: ev.overlayKind ?? "",
  }));
}

/** Dashed card styles for invitations still awaiting a reply or answered "maybe". */
export function timelineRsvp(event: ApiCalendarEvent): CalendarTimelineEvent["rsvp"] {
  const status = event.participationStatus;
  return status === "needs-action" || status === "tentative" ? status : "";
}

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
      displayStart,
      displayEnd,
      timeZone: event.data.timeZone,
      allDay: event.data.allDay === true,
      past: Temporal.PlainDateTime.compare(displayEnd, args.now) <= 0,
      recurring: isCalendarEventRecurring(event),
      exception: isCalendarEventException(event),
      rsvp: timelineRsvp(event),
      locked: isRenderOnlyOverlayEvent(event),
      overlayKind: event.overlayKind,
    };
  });
}
