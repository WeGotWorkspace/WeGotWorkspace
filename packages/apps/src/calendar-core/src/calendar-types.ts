import type { JmapCalendarEvent, JSCalendarRecurrenceRule } from "@/lib/jmap-client";

/**
 * UI-facing calendar collection. Events travel as JSCalendar wire objects
 * (`JmapCalendarEvent` — plain JSON, safe for Dexie and mocks); views convert
 * to the calendar-engine's Temporal model via calendar-event-model.ts.
 */
export type CalendarInfo = {
  id: string;
  name: string;
  color: string;
  /** JMAP/CalDAV `sortOrder` / `calendar-order`; lower sorts first in the sidebar. */
  sortOrder?: number;
  isVisible?: boolean;
  isDefault?: boolean;
  mayWrite?: boolean;
  mayDelete?: boolean;
};

export type CalendarUIData = {
  calendars: CalendarInfo[];
  events: JmapCalendarEvent[];
};

export type CalendarViewId = "month" | "week" | "day" | "year";

/** Grid (calendar) vs list presentation for the selected time-range view. */
export type CalendarPresentation = "grid" | "list";

export type CalendarEventDraft = {
  calendarId: string;
  title: string;
  /** JSCalendar LocalDateTime, e.g. "2033-01-10T10:00:00". */
  start: string;
  /** ISO 8601 duration, e.g. "PT1H" / "P1D". */
  duration: string;
  timeZone?: string;
  allDay?: boolean;
  location?: string;
  description?: string;
  /** JSCalendar recurrence; `null` clears an existing rule on patch. */
  recurrenceRules?: JSCalendarRecurrenceRule[] | null;
};

export type CalendarEventPatch = Partial<Omit<CalendarEventDraft, "calendarId">> & {
  calendarId?: string;
};

export type CalendarDraft = {
  name: string;
  color: string;
};

export type CalendarPatch = {
  name?: string;
  color?: string;
};

export type CalendarAPIOperations = {
  createEvent: (draft: CalendarEventDraft) => Promise<JmapCalendarEvent>;
  patchEvent: (eventId: string, patch: CalendarEventPatch) => Promise<JmapCalendarEvent>;
  deleteEvent: (eventId: string) => Promise<void>;
  createCalendar?: (draft: CalendarDraft) => Promise<CalendarInfo>;
  patchCalendar?: (calendarId: string, patch: CalendarPatch) => Promise<CalendarInfo>;
  deleteCalendar?: (calendarId: string) => Promise<void>;
};
