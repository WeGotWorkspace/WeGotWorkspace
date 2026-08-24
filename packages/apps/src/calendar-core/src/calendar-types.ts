import type { CalendarAttendee, CalendarInvitee } from "@/calendar-core/src/calendar-attendees";
import type {
  CalendarSchedulingNotification,
  CalendarSchedulingRespondOptions,
  CalendarSchedulingRespondStatus,
} from "@/lib/api/wgw/calendar-scheduling";
import type {
  JmapCalendarEvent,
  JSCalendarAlert,
  JSCalendarPatchObject,
  JSCalendarRecurrenceRule,
} from "@/lib/jmap-client";

/**
 * UI-facing calendar collection. Events travel as JSCalendar wire objects
 * (`JmapCalendarEvent` — plain JSON, safe for Dexie and mocks); views convert
 * to the calendar-engine's Temporal model via calendar-event-model.ts.
 */
export type CalendarDirectoryGroup = {
  slug: string;
  displayName: string;
};

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
  scope?: "personal" | "group";
  groupSlug?: string | null;
};

export type CalendarUIData = {
  calendars: CalendarInfo[];
  events: JmapCalendarEvent[];
  groups?: CalendarDirectoryGroup[];
};

export type CalendarViewId = "month" | "week" | "day" | "year";

/** Grid (calendar) vs list presentation for the selected time-range view. */
export type CalendarPresentation = "grid" | "list";

export type CalendarEventDraft = {
  /**
   * Optional persist id. Offline create reuses an engine `local-` key so the
   * working-set map key and Dexie row stay aligned (`eventId` === map key).
   */
  id?: string;
  calendarId: string;
  title: string;
  /** JSCalendar LocalDateTime, e.g. "2033-01-10T10:00:00". */
  start: string;
  /** ISO 8601 duration, e.g. "PT1H" / "P1D". */
  duration: string;
  /**
   * JSCalendar `timeZone`: IANA id when fixed; omit on create / `null` on patch
   * for floating (local wall) time. All-day events omit a timed zone.
   * Timed creates send the device IANA id (`defaultTimedEventTimeZone`).
   */
  timeZone?: string | null;
  allDay?: boolean;
  location?: string;
  description?: string;
  /** JSCalendar recurrence; `null` clears an existing rule on patch. */
  recurrenceRules?: JSCalendarRecurrenceRule[] | null;
  /** JSCalendar `freeBusyStatus`. Default on create is `"busy"`. */
  freeBusyStatus?: "busy" | "free";
  /**
   * JSCalendar `alerts` map. Omit on create when empty; `null` on patch clears
   * existing alarms.
   */
  alerts?: Record<string, JSCalendarAlert> | null;
  /**
   * JSCalendar single-instance patches / exclusions keyed by LocalDateTime.
   * On patch: `null` clears the map; a key mapped to `null` removes that override
   * (needed because some servers deep-merge override maps and cannot drop keys
   * by omission).
   */
  recurrenceOverrides?: Record<string, JSCalendarPatchObject | null> | null;
  attendees?: CalendarAttendee[];
  organizer?: { email: string; name?: string };
};

export type CalendarEventPatch = Partial<Omit<CalendarEventDraft, "calendarId" | "id">> & {
  calendarId?: string;
};

export type CalendarDraft = {
  name: string;
  color: string;
  groupSlug?: string | null;
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
  listSchedulingNotifications?: () => Promise<CalendarSchedulingNotification[]>;
  respondSchedulingNotification?: (
    notificationId: string,
    status: CalendarSchedulingRespondStatus,
    options?: CalendarSchedulingRespondOptions,
  ) => Promise<void>;
  dismissSchedulingNotification?: (notificationId: string) => Promise<void>;
  listInvitees?: () => Promise<{ list: CalendarInvitee[]; canSubmitEmail: boolean }>;
};
