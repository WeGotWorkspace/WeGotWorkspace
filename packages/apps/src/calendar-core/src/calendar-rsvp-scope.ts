import { Temporal } from "@js-temporal/polyfill";
import type {
  RecurrenceScopeChoice,
  RecurrenceScopeRequest,
} from "@/calendar-core/src/calendar-recurrence-scope";
import {
  eventIsRecurringSeries,
  toLocalRecurrenceId,
} from "@/calendar-core/src/calendar-recurrence-scope";
import {
  occurrencesInRange,
  rangeToPlainDateTimeStrings,
  todayISODate,
} from "@/calendar-core/src/calendar-event-model";
import { calendarRespondStatus } from "@/calendar-core/src/calendar-rsvp-actions";
import type { JmapCalendarEvent } from "@/lib/jmap-client";
import type {
  CalendarSchedulingNotification,
  CalendarSchedulingRespondOptions,
  CalendarSchedulingRespondScope,
} from "@/lib/api/wgw/calendar-scheduling";

export type {
  CalendarSchedulingRespondOptions,
  CalendarSchedulingRespondScope,
} from "@/lib/api/wgw/calendar-scheduling";

export function respondScopeFromChoice(
  choice: RecurrenceScopeChoice | null,
): CalendarSchedulingRespondScope | null {
  if (choice === "thisInstance") return "this";
  if (choice === "thisAndFuture") return "future";
  return null;
}

export function eventIsRecurringForRsvp(
  event: Pick<JmapCalendarEvent, "recurrenceRules"> | undefined,
  recurringFlag?: boolean,
  occurrenceKey?: string,
): boolean {
  if (event && eventIsRecurringSeries(event)) return true;
  if (recurringFlag === true) return true;
  return Boolean(occurrenceKey);
}

/**
 * Occurrence the RSVP prompt applies to: clicked instance, else the next
 * upcoming expansion, else the series / notification start.
 */
export function rsvpRecurrenceIdForEvent(args: {
  editorRecurrenceId?: string;
  event?: JmapCalendarEvent;
  notification?: Pick<CalendarSchedulingNotification, "start" | "recurring">;
  now?: Temporal.PlainDateTime;
}): string | undefined {
  const allDay = Boolean(args.event?.showWithoutTime);
  if (args.editorRecurrenceId) {
    return toLocalRecurrenceId(args.editorRecurrenceId, allDay, args.event?.start);
  }
  if (args.event && eventIsRecurringSeries(args.event)) {
    const today = todayISODate();
    const range = rangeToPlainDateTimeStrings({
      start: Temporal.PlainDate.from(today),
      end: Temporal.PlainDate.from(today).add({ days: 90 }),
    });
    const next = occurrencesInRange([args.event], range)[0];
    if (next) {
      return next.start.toString({ smallestUnit: "second" });
    }
    if (args.event.start) return args.event.start;
  }
  return args.notification?.start ?? args.event?.start ?? undefined;
}

export type CalendarRsvpPersistSource = "sidebar" | "dialog" | "preview";

/**
 * Occurrence-scope prompt is only for changing an already-set RSVP
 * (accepted / tentative / declined) from the edit-event dialog on a series.
 * Sidebar and first response (needs-action / missing PARTSTAT) stay series-wide.
 */
export function shouldAskRsvpOccurrenceScope(args: {
  source: CalendarRsvpPersistSource;
  recurring: boolean;
  previousStatus?: string | null;
}): boolean {
  return (
    (args.source === "dialog" || args.source === "preview") &&
    args.recurring &&
    calendarRespondStatus(args.previousStatus) !== undefined
  );
}

export async function persistInviteeRsvp(args: {
  source: CalendarRsvpPersistSource;
  recurring: boolean;
  previousStatus?: string | null;
  masterId: string;
  recurrenceId?: string;
  askScope: (request: RecurrenceScopeRequest) => Promise<RecurrenceScopeChoice | null>;
  respond: (
    options?: Pick<CalendarSchedulingRespondOptions, "scope" | "recurrenceId">,
  ) => Promise<void>;
}): Promise<boolean> {
  if (!shouldAskRsvpOccurrenceScope(args)) {
    await args.respond();
    return true;
  }
  const asked = await args.askScope({
    action: "edit",
    masterId: args.masterId,
    ...(args.recurrenceId ? { recurrenceId: args.recurrenceId } : {}),
  });
  const scope = respondScopeFromChoice(asked);
  if (!scope) return false;
  await args.respond({
    scope,
    ...(args.recurrenceId ? { recurrenceId: args.recurrenceId } : {}),
  });
  return true;
}
