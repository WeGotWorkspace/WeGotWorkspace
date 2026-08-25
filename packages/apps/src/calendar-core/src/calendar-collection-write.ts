import { isSharedWithMeCalendar } from "@/calendar-core/src/calendar-share";
import type { CalendarInfo } from "@/calendar-core/src/calendar-types";

export type CalendarCollectionWriteInfo = Pick<CalendarInfo, "scope" | "mayShare" | "mayWrite">;
export type CalendarSettingsInfo = Pick<
  CalendarInfo,
  "scope" | "groupSlug" | "mayShare" | "mayWrite" | "subscriptionId"
>;

/**
 * Personal owners (`mayShare === true` or omitted). Group calendars stay
 * non-owners here so the invitee RSVP lock does not apply to team events
 * even after group members get `mayShare` for collection ACL / publish.
 */
export function isCalendarCollectionOwner(calendar?: CalendarCollectionWriteInfo): boolean {
  if (calendar?.scope === "group") return false;
  return calendar?.mayShare !== false;
}

/**
 * Who may edit shareWith and publish a public feed. Group members get
 * `mayShare: true` from the API (same people who can edit calendar settings).
 */
export function canManageCalendarSharing(calendar?: CalendarCollectionWriteInfo): boolean {
  if (calendar?.mayShare === true) return true;
  if (calendar?.mayShare === false) return false;
  return calendar?.scope !== "group";
}

/** Collection-level write (create / drag / resize). `mayWrite` omitted is writable. */
export function canWriteCalendarCollection(calendar?: CalendarCollectionWriteInfo): boolean {
  return calendar?.mayWrite !== false;
}

/** Open Edit calendar — owners, team, subscriptions, and ACL sharees (name + color). */
export function canOpenCalendarSettings(calendar?: CalendarSettingsInfo): boolean {
  if (!calendar) return false;
  return (
    canWriteCalendarCollection(calendar) ||
    Boolean(calendar.subscriptionId) ||
    isSharedWithMeCalendar(calendar)
  );
}

/** Personal displayname on this instance — owners, sharees, and subscriptions. */
export function canRenameCalendar(calendar?: CalendarSettingsInfo): boolean {
  return canOpenCalendarSettings(calendar);
}

/**
 * Event-dialog field lock. Owned personal calendars keep the invitee RSVP lock;
 * group and write-share collections follow `mayWrite`.
 */
export function isCalendarEventFormReadOnly(args: {
  mode: "create" | "edit";
  calendar?: CalendarCollectionWriteInfo;
  isOrganizer: boolean;
}): boolean {
  if (args.mode !== "edit") return false;
  return isCalendarCollectionOwner(args.calendar)
    ? !args.isOrganizer
    : args.calendar?.mayWrite === false;
}
