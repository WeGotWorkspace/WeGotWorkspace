import type { CalendarInfo } from "@/calendar-core/src/calendar-types";
import type { JmapCalendarEvent } from "@/lib/jmap-client";
import {
  listCachedEventsForCalendar,
  listPendingCalendarEventIds,
  removeCalendarEventFromCache,
  removeCalendarFromCache,
  upsertCalendarEventInCache,
  upsertCalendarInCache,
} from "@/lib/offline/calendars-offline-store";
import { reportCalendarsSyncConflicts } from "@/lib/offline/calendars-sync-conflicts";

async function pendingSet(username: string): Promise<Set<string>> {
  return new Set(await listPendingCalendarEventIds(username));
}

/**
 * Ingest a remote JMAP event into Dexie. Pending outbox / pendingSync rows are
 * not overwritten; a clash still goes through `reportCalendarsSyncConflicts`.
 */
export async function ingestRemoteCalendarEvent(
  username: string,
  event: JmapCalendarEvent,
): Promise<"upserted" | "skipped-pending"> {
  if (!event.id) return "skipped-pending";
  const pending = await pendingSet(username);
  if (pending.has(event.id)) {
    reportCalendarsSyncConflicts([event.id]);
    return "skipped-pending";
  }
  await upsertCalendarEventInCache(username, event, false, false);
  return "upserted";
}

/** Drop a remotely destroyed event unless a local pending write still owns the id. */
export async function ingestRemoteCalendarEventDestroyed(
  username: string,
  eventId: string,
): Promise<"removed" | "skipped-pending"> {
  const pending = await pendingSet(username);
  if (pending.has(eventId)) {
    reportCalendarsSyncConflicts([eventId]);
    return "skipped-pending";
  }
  await removeCalendarEventFromCache(username, eventId);
  return "removed";
}

/** Upsert a remote Calendar/get object into the Dexie calendar list. */
export async function ingestRemoteCalendar(
  username: string,
  calendar: CalendarInfo,
): Promise<"upserted"> {
  await upsertCalendarInCache(username, calendar);
  return "upserted";
}

/**
 * Drop a remotely destroyed calendar and its cached events. Pending outbox
 * event rows stay so flush/conflict handling can run.
 */
export async function ingestRemoteCalendarDestroyed(
  username: string,
  calendarId: string,
): Promise<"removed"> {
  const pending = await pendingSet(username);
  const rows = await listCachedEventsForCalendar(username, calendarId);
  const conflicts: string[] = [];
  for (const row of rows) {
    if (pending.has(row.id)) {
      conflicts.push(row.id);
      continue;
    }
    await removeCalendarEventFromCache(username, row.id);
  }
  if (conflicts.length > 0) {
    reportCalendarsSyncConflicts(conflicts);
  }
  await removeCalendarFromCache(username, calendarId);
  return "removed";
}
