import type { CalendarInfo } from "@/calendar-core/src/calendar-types";

export type CalendarCollectionWriteInfo = Pick<CalendarInfo, "scope" | "mayShare" | "mayWrite">;

/**
 * Personal owners (`mayShare === true`) and personal calendars that omit the
 * flag. Group and sharee collections set `mayShare === false`.
 */
export function isCalendarCollectionOwner(calendar?: CalendarCollectionWriteInfo): boolean {
  const isGroup = calendar?.scope === "group";
  return calendar?.mayShare === true || (calendar?.mayShare !== false && !isGroup);
}

/** Collection-level write (create / drag / resize). `mayWrite` omitted is writable. */
export function canWriteCalendarCollection(calendar?: CalendarCollectionWriteInfo): boolean {
  return calendar?.mayWrite !== false;
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
