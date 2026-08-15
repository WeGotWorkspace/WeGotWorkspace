/**
 * JSCalendar (RFC 8984) wire types — the subset this client maps onto the internal model.
 * Every object carries an index signature so properties we do not model (participants,
 * alerts, privacy, links, …) survive round-trips untouched.
 */

/** "2026-01-15T09:00:00" — local date-time without offset (RFC 8984 section 1.4.4). */
export type JSCalendarLocalDateTime = string;

/** "2026-01-15T09:00:00Z" — UTC date-time (RFC 8984 section 1.4.3). */
export type JSCalendarUTCDateTime = string;

/** ISO 8601 duration, e.g. "PT1H30M" or "P1D" (RFC 8984 section 1.4.5). */
export type JSCalendarDuration = string;

/** Lowercase two-letter weekday used by JSCalendar ("mo".."su"). */
export type JSCalendarWeekday = "mo" | "tu" | "we" | "th" | "fr" | "sa" | "su";

export type JSCalendarNDay = {
  "@type"?: "NDay";
  day: JSCalendarWeekday;
  nthOfPeriod?: number;
  [key: string]: unknown;
};

export type JSCalendarRecurrenceRule = {
  "@type"?: "RecurrenceRule";
  frequency: "yearly" | "monthly" | "weekly" | "daily" | "hourly" | "minutely" | "secondly";
  interval?: number;
  rscale?: string;
  skip?: "omit" | "backward" | "forward";
  firstDayOfWeek?: JSCalendarWeekday;
  byDay?: JSCalendarNDay[];
  byMonthDay?: number[];
  /** Month numbers as strings; may carry an "L" suffix under non-Gregorian rscale. */
  byMonth?: string[];
  byYearDay?: number[];
  byWeekNo?: number[];
  byHour?: number[];
  byMinute?: number[];
  bySecond?: number[];
  bySetPosition?: number[];
  count?: number;
  until?: JSCalendarLocalDateTime;
  [key: string]: unknown;
};

export type JSCalendarLocation = {
  "@type"?: "Location";
  name?: string;
  [key: string]: unknown;
};

/**
 * A recurrence override: a patch of the base event keyed by JSON pointer-ish paths
 * (RFC 8984 section 4.3.4). `{ excluded: true }` marks a removed occurrence.
 */
export type JSCalendarPatchObject = Record<string, unknown>;

/** JSCalendar Event (RFC 8984 section 2). Unknown properties are preserved opaquely. */
export type JSCalendarEvent = {
  "@type": "Event";
  uid: string;
  title?: string;
  description?: string;
  start: JSCalendarLocalDateTime;
  timeZone?: string | null;
  duration?: JSCalendarDuration;
  /**
   * Non-RFC convenience some servers emit from iCalendar DTEND (e.g. Apple CalDAV).
   * Prefer `duration`; clients should derive duration from start→end when needed.
   */
  end?: JSCalendarLocalDateTime;
  showWithoutTime?: boolean;
  color?: string;
  status?: "confirmed" | "cancelled" | "tentative";
  locations?: Record<string, JSCalendarLocation> | null;
  recurrenceRules?: JSCalendarRecurrenceRule[] | null;
  excludedRecurrenceRules?: JSCalendarRecurrenceRule[] | null;
  recurrenceOverrides?: Record<JSCalendarLocalDateTime, JSCalendarPatchObject> | null;
  /** Present when this object itself represents a single overridden occurrence. */
  recurrenceId?: JSCalendarLocalDateTime;
  updated?: JSCalendarUTCDateTime;
  [key: string]: unknown;
};
