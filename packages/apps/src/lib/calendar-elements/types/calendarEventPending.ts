import type { CalendarEventPendingOperation, CalendarEventsMap } from "@/lib/calendar-engine";

export type CalendarEventPendingGroupKey = CalendarEventPendingOperation;

export type CalendarEventPendingGroupBy = "pendingOp" | "calendarId";

export type CalendarEventPendingOptions = {
  groupBy?: CalendarEventPendingGroupBy;
};

export type CalendarEventPendingGroups = Map<CalendarEventPendingGroupKey, CalendarEventsMap>;
export type CalendarEventPendingByOperation = Map<CalendarEventPendingOperation, CalendarEventsMap>;
export type CalendarEventPendingByEventId = Map<string, CalendarEventPendingByOperation>;
export type CalendarEventPendingByCalendarId = Map<string, CalendarEventPendingByEventId>;
export type CalendarEventPendingResult =
  | CalendarEventPendingGroups
  | CalendarEventPendingByCalendarId;
