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
