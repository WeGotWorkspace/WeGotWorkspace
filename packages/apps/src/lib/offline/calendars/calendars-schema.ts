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

export type OfflineCalendarGroupRow = {
  slug: string;
  sortOrder: number;
  /** JSON-serialized CalendarDirectoryGroup. */
  data: string;
};

export type OfflineCalendarInboxRow = {
  id: string;
  sortOrder: number;
  /** JSON-serialized CalendarSchedulingNotification. */
  data: string;
};

export type OfflineCalendarInviteeRow = {
  username: string;
  sortOrder: number;
  /** JSON-serialized CalendarInvitee. */
  data: string;
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
    {
      version: CALENDARS_OFFLINE_VERSION.groups,
      stores: {
        calendars_groups: "slug, sortOrder",
      },
    },
    {
      version: CALENDARS_OFFLINE_VERSION.scheduling,
      stores: {
        calendars_inbox: "id, sortOrder",
        calendars_invitees: "username, sortOrder",
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

export function calendarsGroupsTable(
  db: WgwOfflineDatabase,
): EntityTable<OfflineCalendarGroupRow, "slug"> {
  return db.table<OfflineCalendarGroupRow, string>("calendars_groups") as EntityTable<
    OfflineCalendarGroupRow,
    "slug"
  >;
}

export function calendarsInboxTable(
  db: WgwOfflineDatabase,
): EntityTable<OfflineCalendarInboxRow, "id"> {
  return db.table<OfflineCalendarInboxRow, string>("calendars_inbox") as EntityTable<
    OfflineCalendarInboxRow,
    "id"
  >;
}

export function calendarsInviteesTable(
  db: WgwOfflineDatabase,
): EntityTable<OfflineCalendarInviteeRow, "username"> {
  return db.table<OfflineCalendarInviteeRow, string>("calendars_invitees") as EntityTable<
    OfflineCalendarInviteeRow,
    "username"
  >;
}
