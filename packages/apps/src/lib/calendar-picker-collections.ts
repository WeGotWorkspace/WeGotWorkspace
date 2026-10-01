import { useEffect, useState } from "react";
import { wgwLiveApiEnabled } from "@/lib/api/wgw/http";
import { JmapCalendarsClient, type JmapCalendar } from "@/lib/jmap-client";
import type { CalendarPickerCalendar } from "@/lib/calendar-event-calendar-picker";
import { readCalendarDisplayPrefs } from "@/lib/calendar-display-prefs";
import { shareRightsAllowWrite } from "@/share-ui/collection-share";
import { calendarJmapClient } from "@/lib/api/wgw/calendar";

/** Mock-tier writable calendars — same ids/names as the Calendar story bootstrap. */
export const MOCK_CALENDAR_PICKER_COLLECTIONS: CalendarPickerCalendar[] = [
  { id: "default", name: "Personal", color: "#6366f1", isDefault: true },
  { id: "work", name: "Work", color: "#0ea5e9" },
];

/**
 * Provisioned personal calendar. Shown until Calendar/get returns when the
 * user has no saved id, or the saved id is already this calendar.
 */
const LIVE_CALENDAR_PICKER_DEFAULT: CalendarPickerCalendar = {
  id: "default",
  name: "Calendar",
  color: "#6366f1",
  isDefault: true,
};

export function initialCalendarPickerCollections(): CalendarPickerCalendar[] {
  if (!wgwLiveApiEnabled()) return MOCK_CALENDAR_PICKER_COLLECTIONS;
  const savedId = readCalendarDisplayPrefs().inviteCalendarId;
  if (savedId && savedId !== LIVE_CALENDAR_PICKER_DEFAULT.id) return [];
  return [LIVE_CALENDAR_PICKER_DEFAULT];
}

function toPickerCalendar(calendar: JmapCalendar): CalendarPickerCalendar {
  return {
    id: calendar.id,
    name: calendar.name,
    color: calendar.color ?? "#6366f1",
    mayWrite: calendar.myRights ? shareRightsAllowWrite(calendar.myRights) : true,
    isDefault: calendar.isDefault ?? calendar.id === "default",
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

export type CalendarPickerCollectionsState = {
  collections: CalendarPickerCalendar[];
  /** False while a live list is still in flight. Mock mode is loaded immediately. */
  loaded: boolean;
};

export function useCalendarPickerCollections(): CalendarPickerCollectionsState {
  const [collections, setCollections] = useState(() => initialCalendarPickerCollections());
  const [loaded, setLoaded] = useState(() => !wgwLiveApiEnabled());

  useEffect(() => {
    let cancelled = false;
    if (wgwLiveApiEnabled()) {
      setCollections(initialCalendarPickerCollections());
      setLoaded(false);
    }
    void loadCalendarPickerCollections().then((next) => {
      if (cancelled) return;
      setCollections(next);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { collections, loaded };
}
