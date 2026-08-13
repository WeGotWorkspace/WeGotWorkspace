import type { EntityTable } from "dexie";
import {
  registerOfflineDomainTables,
  type WgwOfflineDatabase,
} from "@/lib/offline/core/offline-db";
import { CALENDARS_OFFLINE_VERSION } from "@/lib/offline/core/offline-version-allocation";

export type OfflineCalendarRow = {
  id: string;
  /** JSON-serialized CalendarInfo. */
  data: string;
};

export type OfflineCalendarEventRow = {
  id: string;
  calendarId: string;
  /** JSON-serialized JmapCalendarEvent (JSCalendar wire shape). */
  data: string;
  pendingSync: boolean;
  /** Last local write time (epoch ms). */
  updatedAt: number;
};

export const CALENDARS_DOMAIN = "calendars";

registerOfflineDomainTables({
  domain: CALENDARS_DOMAIN,
  versions: [
    {
      version: CALENDARS_OFFLINE_VERSION.tables,
      stores: {
        calendars_calendars: "id",
        calendars_events: "id, calendarId, pendingSync, updatedAt",
      },
    },
  ],
});

export function calendarsEventsTable(
  db: WgwOfflineDatabase,
): EntityTable<OfflineCalendarEventRow, "id"> {
  return db.table<OfflineCalendarEventRow, string>("calendars_events") as EntityTable<
    OfflineCalendarEventRow,
    "id"
  >;
}

export function calendarsCalendarsTable(
  db: WgwOfflineDatabase,
): EntityTable<OfflineCalendarRow, "id"> {
  return db.table<OfflineCalendarRow, string>("calendars_calendars") as EntityTable<
    OfflineCalendarRow,
    "id"
  >;
}
