import { useEffect, useState } from "react";
import { wgwLiveApiEnabled } from "@/lib/api/wgw/http";
import { JmapCalendarsClient, type JmapCalendar } from "@/lib/jmap-client";
import type { CalendarPickerCalendar } from "@/lib/calendar-event-calendar-picker";
import { shareRightsAllowWrite } from "@/share-ui/collection-share";
import { calendarJmapClient } from "@/lib/api/wgw/calendar";

/** Mock-tier writable calendars — same ids/names as the Calendar story bootstrap. */
export const MOCK_CALENDAR_PICKER_COLLECTIONS: CalendarPickerCalendar[] = [
  { id: "default", name: "Personal", color: "#6366f1", isDefault: true },
  { id: "work", name: "Work", color: "#0ea5e9" },
];

/** Provisioned personal calendar, shown until Calendar/get returns. */
const LIVE_CALENDAR_PICKER_DEFAULT: CalendarPickerCalendar = {
  id: "default",
  name: "Calendar",
  color: "#6366f1",
  isDefault: true,
};

export function initialCalendarPickerCollections(): CalendarPickerCalendar[] {
  if (!wgwLiveApiEnabled()) return MOCK_CALENDAR_PICKER_COLLECTIONS;
  return [LIVE_CALENDAR_PICKER_DEFAULT];
}

function toPickerCalendar(calendar: JmapCalendar): CalendarPickerCalendar {
  return {
    id: calendar.id,
    name: calendar.name,
    color: calendar.color ?? "#6366f1",
    mayWrite: calendar.myRights ? shareRightsAllowWrite(calendar.myRights) : true,
    isDefault: calendar.isDefault === true || calendar.id === "default",
  };
}

/** Writable-aware calendar list for the Settings invite picker. Reuses `calendarJmapClient`. */
export async function loadCalendarPickerCollections(): Promise<CalendarPickerCalendar[]> {
  if (!wgwLiveApiEnabled()) return MOCK_CALENDAR_PICKER_COLLECTIONS;
  try {
    const client = calendarJmapClient();
    if (!client.isConnected) await client.connect();
    const calendars = new JmapCalendarsClient(client);
    const get = await calendars.getCalendars(client.primaryAccountId());
    return get.list.map(toPickerCalendar);
  } catch {
    return [];
  }
}

export function useCalendarPickerCollections(): CalendarPickerCalendar[] {
  const [calendars, setCalendars] = useState(() => initialCalendarPickerCollections());

  useEffect(() => {
    let cancelled = false;
    void loadCalendarPickerCollections().then((next) => {
      if (!cancelled && next.length > 0) setCalendars(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return calendars;
}
