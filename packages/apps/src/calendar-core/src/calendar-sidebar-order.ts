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

export function isGroupCalendar(calendar: Pick<CalendarInfo, "scope" | "groupSlug">): boolean {
  return calendar.scope === "group" && Boolean(calendar.groupSlug?.trim());
}

export function personalCalendarsForSidebar<T extends CalendarInfo>(calendars: readonly T[]): T[] {
  return sortCalendarsForSidebar(calendars.filter((calendar) => !isGroupCalendar(calendar)));
}

export function teamCalendarsForSidebar<T extends CalendarInfo>(calendars: readonly T[]): T[] {
  return sortCalendarsForSidebar(calendars.filter((calendar) => isGroupCalendar(calendar)));
}
