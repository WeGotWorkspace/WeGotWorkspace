/**
 * JMAP for Calendars draft types (https://jmap.io/spec/calendars-draft/): the Calendar
 * object, CalendarRights, and the CalendarEvent wrapper (a JSCalendar Event plus
 * JMAP-specific properties).
 */

import type { JmapId } from "../core/types.js";
import type { JSCalendarEvent, JSCalendarUTCDateTime } from "../jscalendar/types.js";

/** CalendarRights (calendars draft section 4). */
export type JmapCalendarRights = {
  mayReadFreeBusy: boolean;
  mayReadItems: boolean;
  mayWriteAll: boolean;
  mayWriteOwn: boolean;
  mayUpdatePrivate: boolean;
  mayRSVP: boolean;
  mayShare: boolean;
  mayDelete: boolean;
  [key: string]: unknown;
};

/** Calendar object (calendars draft section 4). */
export type JmapCalendar = {
  id: JmapId;
  name: string;
  description?: string | null;
  color?: string | null;
  sortOrder?: number;
  isSubscribed?: boolean;
  isVisible?: boolean;
  isDefault?: boolean;
  includeInAvailability?: "all" | "attending" | "none";
  timeZone?: string | null;
  shareWith?: Record<JmapId, JmapCalendarRights> | null;
  myRights?: JmapCalendarRights;
  [key: string]: unknown;
};

/** CalendarEvent = JSCalendar Event + JMAP additions (calendars draft section 5). */
export type JmapCalendarEvent = JSCalendarEvent & {
  id: JmapId;
  baseEventId?: JmapId | null;
  /** Set of Calendar ids this event belongs to; every value is `true`. */
  calendarIds: Record<JmapId, true>;
  isDraft?: boolean;
  isOrigin?: boolean;
  utcStart?: JSCalendarUTCDateTime;
  utcEnd?: JSCalendarUTCDateTime;
  useDefaultAlerts?: boolean;
};

/** FilterCondition for CalendarEvent/query (calendars draft section 5.5). */
export type JmapCalendarEventFilterCondition = {
  inCalendars?: JmapId[] | null;
  /** Occurrences ending after this UTC time (inclusive lower bound of the window). */
  after?: JSCalendarUTCDateTime;
  /** Occurrences starting before this UTC time (exclusive upper bound of the window). */
  before?: JSCalendarUTCDateTime;
  uid?: string;
  text?: string;
  title?: string;
  description?: string;
  location?: string;
  [key: string]: unknown;
};
