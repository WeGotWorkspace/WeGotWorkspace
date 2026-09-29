import { useEffect, useState } from "react";
import { wgwApiBaseUrl, wgwFetch, wgwLiveApiEnabled } from "@/lib/api/wgw/http";
import { JmapCalendarsClient, JmapClient, type JmapCalendar } from "@/lib/jmap-client";
import type { CalendarPickerCalendar } from "@/lib/calendar-event-calendar-picker";
import { shareRightsAllowWrite } from "@/share-ui/collection-share";

/** Mock-tier writable calendars — same ids/names as the Calendar story bootstrap. */
export const MOCK_CALENDAR_PICKER_COLLECTIONS: CalendarPickerCalendar[] = [
  { id: "default", name: "Personal", color: "#6366f1" },
  { id: "work", name: "Work", color: "#0ea5e9" },
];

function toApiRelativePath(input: string): string {
  const base = wgwApiBaseUrl();
  const url = new URL(input, window.location.origin);
  const path = url.pathname + url.search;
  return path.startsWith(base) ? path.slice(base.length) : path;
}

function toPickerCalendar(calendar: JmapCalendar): CalendarPickerCalendar {
  return {
    id: calendar.id,
    name: calendar.name,
    color: calendar.color ?? "#6366f1",
    mayWrite: calendar.myRights ? shareRightsAllowWrite(calendar.myRights) : true,
  };
}

/** Writable-aware calendar list for the Settings invite picker. Does not import calendar-core. */
export async function loadCalendarPickerCollections(): Promise<CalendarPickerCalendar[]> {
  if (!wgwLiveApiEnabled()) return MOCK_CALENDAR_PICKER_COLLECTIONS;
  try {
    const client = new JmapClient({
      sessionUrl: "/jmap/session",
      fetch: (input, init) => wgwFetch(toApiRelativePath(String(input)), init ?? {}),
    });
    if (!client.isConnected) await client.connect();
    const calendars = new JmapCalendarsClient(client);
    const get = await calendars.getCalendars(client.primaryAccountId());
    return get.list.map(toPickerCalendar);
  } catch {
    return [];
  }
}

export function useCalendarPickerCollections(): CalendarPickerCalendar[] {
  const [calendars, setCalendars] = useState<CalendarPickerCalendar[]>([]);

  useEffect(() => {
    let cancelled = false;
    void loadCalendarPickerCollections().then((next) => {
      if (!cancelled) setCalendars(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return calendars;
}
