import type { Calendar, CalendarsMap } from "@/lib/calendar-engine";

type AccountCalendarGroup = {
  accountId: string;
  entries: Array<[string, Calendar]>;
};

/** Groups by {@link Calendar.accountId}; accounts and calendars within each account are sorted by name/id. */
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
    list.sort((a, b) =>
      a[1].displayName.localeCompare(b[1].displayName, undefined, { sensitivity: "base" }),
    );
  }
  return [...byAccount.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .map(([accountId, entries]) => ({ accountId, entries }));
}

/** Calendar ids in sidebar display order (account groups, then display name). */
export function calendarIdsInSidebarOrder(map: CalendarsMap): string[] {
  return calendarEntriesByAccount(map).flatMap((g) => g.entries.map(([id]) => id));
}
