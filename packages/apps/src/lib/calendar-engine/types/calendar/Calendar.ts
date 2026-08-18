import type { CalendarAccountId } from "./CalendarAccountId.js";
import type { CalendarRights } from "./CalendarRights.js";
import type { CalendarUrl } from "./CalendarUrl.js";

/**
 * Display and sync metadata for one calendar. The {@link CalendarsMap} key is {@link CalendarId},
 * not duplicated here.
 */
export type Calendar = {
  accountId: CalendarAccountId;
  /** Resource URL; may match another calendar’s URL under a different account. */
  url: CalendarUrl;
  displayName: string;
  color: string;
  /** Whether the user currently wants this calendar's events shown. Absent means visible. */
  isVisible?: boolean;
  /** Consistent UI ordering across devices; lower sorts first. */
  sortOrder?: number;
  /** The calendar new events default into when the user hasn't chosen one. */
  isDefault?: boolean;
  /** Access rights for the current user; absent for local-only calendars. */
  myRights?: CalendarRights;
};
