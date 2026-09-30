import { useEffect, useState } from "react";
import { wgwLiveApiEnabled } from "@/lib/api/wgw/http";
import { JmapCalendarsClient, type JmapCalendar } from "@/lib/jmap-client";
import type { CalendarPickerCalendar } from "@/lib/calendar-event-calendar-picker";
import { shareRightsAllowWrite } from "@/share-ui/collection-share";
import { connectWgwJmapClient } from "@/lib/wgw-jmap-session";

/** Mock-tier writable calendars — same ids/names as the Calendar story bootstrap. */
export const MOCK_CALENDAR_PICKER_COLLECTIONS: CalendarPickerCalendar[] = [
  { id: "default", name: "Personal", color: "#6366f1" },
  { id: "work", name: "Work", color: "#0ea5e9" },
];

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
    const client = await connectWgwJmapClient();
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
