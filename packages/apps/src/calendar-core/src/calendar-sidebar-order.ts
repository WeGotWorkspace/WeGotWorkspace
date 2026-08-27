import {
  isSharedWithMeCollection,
  partitionOwnedAndShared,
  sortCollectionsByName,
} from "@/collection-sidebar/src/collection-sidebar-partition";
import type { CalendarInfo } from "@/calendar-core/src/calendar-types";

/** Sidebar display order: `sortOrder` ascending, then name (localeCompare). */
export function compareCalendarsForSidebar(
  a: Pick<CalendarInfo, "name" | "sortOrder">,
  b: Pick<CalendarInfo, "name" | "sortOrder">,
): number {
  const orderA = a.sortOrder ?? 0;
  const orderB = b.sortOrder ?? 0;
  if (orderA !== orderB) return orderA - orderB;
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

export function sortCalendarsForSidebar<T extends Pick<CalendarInfo, "name" | "sortOrder">>(
  calendars: readonly T[],
): T[] {
  return [...calendars].sort(compareCalendarsForSidebar);
}

export function sortCalendarsAlphabetically<T extends Pick<CalendarInfo, "name">>(
  calendars: readonly T[],
): T[] {
  return sortCollectionsByName(calendars);
}

export function isGroupCalendar(calendar: Pick<CalendarInfo, "scope" | "groupSlug">): boolean {
  return calendar.scope === "group" && Boolean(calendar.groupSlug?.trim());
}

export function calendarIsSharee(
  calendar: Pick<CalendarInfo, "scope" | "groupSlug" | "mayShare" | "isSharee">,
): boolean {
  if (typeof calendar.isSharee === "boolean") return calendar.isSharee;
  return !isGroupCalendar(calendar) && calendar.mayShare === false;
}

export function calendarIsSubscription(calendar: Pick<CalendarInfo, "subscriptionId">): boolean {
  return Boolean(calendar.subscriptionId);
}

const CALENDAR_PARTITION = {
  isSharee: calendarIsSharee,
  isSubscription: calendarIsSubscription,
};

/** Inbound ACL sharee — not group membership and not an ICS subscription. */
export function isSharedWithMeCalendar(
  calendar: Pick<CalendarInfo, "scope" | "groupSlug" | "mayShare" | "subscriptionId" | "isSharee">,
): boolean {
  return isSharedWithMeCollection(calendar, CALENDAR_PARTITION);
}

export function ownedAndTeamCalendarsForSidebar<T extends CalendarInfo>(
  calendars: readonly T[],
): T[] {
  return partitionOwnedAndShared(calendars, CALENDAR_PARTITION).owned;
}

export function sharedWithMeCalendarsForSidebar<T extends CalendarInfo>(
  calendars: readonly T[],
): T[] {
  return partitionOwnedAndShared(calendars, CALENDAR_PARTITION).shared;
}
