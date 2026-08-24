import type { CalendarInvitee } from "@/calendar-core/src/calendar-attendees";
import type { CalendarSchedulingNotification } from "@/lib/api/wgw/calendar-scheduling";
import {
  calendarsInboxTable,
  calendarsInviteesTable,
} from "@/lib/offline/calendars/calendars-schema";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";

const META_CAN_SUBMIT_EMAIL = "calendars:invitees:canSubmitEmail";

export async function readCalendarSchedulingInbox(
  username: string,
): Promise<CalendarSchedulingNotification[]> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const rows = (await calendarsInboxTable(db).toArray()).sort(
    (left, right) => left.sortOrder - right.sortOrder,
  );
  return rows.map((row) => JSON.parse(row.data) as CalendarSchedulingNotification);
}

export async function writeCalendarSchedulingInbox(
  username: string,
  notifications: CalendarSchedulingNotification[],
): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const table = calendarsInboxTable(db);
  await table.clear();
  await table.bulkPut(
    notifications.map((notification, sortOrder) => ({
      id: notification.id,
      sortOrder,
      data: JSON.stringify(notification),
    })),
  );
}

export async function readCalendarInviteesDirectory(username: string): Promise<{
  list: CalendarInvitee[];
  canSubmitEmail: boolean;
} | null> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const rows = (await calendarsInviteesTable(db).toArray()).sort(
    (left, right) => left.sortOrder - right.sortOrder,
  );
  if (rows.length === 0) return null;
  const canSubmit = await db.meta.get(META_CAN_SUBMIT_EMAIL);
  return {
    list: rows.map((row) => JSON.parse(row.data) as CalendarInvitee),
    canSubmitEmail: canSubmit?.value === "true",
  };
}

export async function writeCalendarInviteesDirectory(
  username: string,
  directory: { list: CalendarInvitee[]; canSubmitEmail: boolean },
): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const table = calendarsInviteesTable(db);
  await table.clear();
  await table.bulkPut(
    directory.list.map((invitee, sortOrder) => ({
      username: invitee.username,
      sortOrder,
      data: JSON.stringify(invitee),
    })),
  );
  await db.meta.put({
    key: META_CAN_SUBMIT_EMAIL,
    value: directory.canSubmitEmail ? "true" : "false",
  });
}
