import type { Calendar, CalendarsMap } from "@/lib/calendar-engine";

type AccountCalendarGroup = {
  accountId: string;
  entries: Array<[string, Calendar]>;
};

function compareCalendarEntries(a: [string, Calendar], b: [string, Calendar]): number {
  const orderA = a[1].sortOrder ?? 0;
  const orderB = b[1].sortOrder ?? 0;
  if (orderA !== orderB) return orderA - orderB;
  return a[1].displayName.localeCompare(b[1].displayName, undefined, { sensitivity: "base" });
}

/** Groups by {@link Calendar.accountId}; calendars within each account use sortOrder then name. */
export function calendarEntriesByAccount(map: CalendarsMap): AccountCalendarGroup[] {
  const byAccount = new Map<string, Array<[string, Calendar]>>();
  for (const entry of map.entries()) {
    const [calendarId, cal] = entry;
    const accountKey = cal.accountId;
    const bucket = byAccount.get(accountKey) ?? [];
    bucket.push([calendarId, cal]);
    byAccount.set(accountKey, bucket);
  }
  for (const list of byAccount.values()) {
    list.sort(compareCalendarEntries);
  }
  return [...byAccount.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .map(([accountId, entries]) => ({ accountId, entries }));
}

/** Calendar ids in sidebar display order (account groups, then sortOrder/name). */
export function calendarIdsInSidebarOrder(map: CalendarsMap): string[] {
  return calendarEntriesByAccount(map).flatMap((g) => g.entries.map(([id]) => id));
}
