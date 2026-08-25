import type { CalendarAppBootstrap } from "@/lib/api/mock/calendar-bootstrap";
import type { JmapCalendarEvent } from "@/lib/jmap-client";
import type {
  CalendarDirectoryGroup,
  CalendarEventPatch,
  CalendarInfo,
} from "@/calendar-core/src/calendar-types";
import { rememberOfflineCalendarsUsername } from "@/lib/offline/offline-session";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import {
  isRetryableOutboxRow,
  listOutboxMutationsForDomain,
} from "@/lib/offline/core/outbox-store";
import { enqueueCoalescedOutboxUpdate } from "@/lib/offline/core/outbox-coalescing";
import type { OfflineOutboxRow } from "@/lib/offline/core/types";
import {
  CALENDARS_DOMAIN,
  calendarsCalendarsTable,
  calendarsEventsTable,
  calendarsGroupsTable,
  type OfflineCalendarEventRow,
} from "@/lib/offline/calendars/calendars-schema";
import { coalesceCalendarEventPatches } from "@/lib/offline/calendars/calendars-patch-merge";

export {
  enqueueOutboxMutation,
  listOutboxMutations,
  markOutboxError,
  removeOutboxMutation,
} from "@/lib/offline/core/outbox-store";

const META_SESSION = "calendars:session";
const META_SYNC_TOKEN_PREFIX = "calendars:sync:";

function eventCalendarId(event: JmapCalendarEvent): string {
  return Object.keys(event.calendarIds ?? {})[0] ?? "";
}

function eventRow(
  event: JmapCalendarEvent,
  pendingSync: boolean,
  locallyWritten = false,
): OfflineCalendarEventRow {
  return {
    id: event.id,
    calendarId: eventCalendarId(event),
    data: JSON.stringify(event),
    pendingSync,
    updatedAt: Date.now(),
    ...(locallyWritten ? { locallyWritten: true } : {}),
  };
}

export async function readCalendarBootstrapFromCache(
  username: string,
): Promise<CalendarAppBootstrap | null> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const sessionRow = await db.meta.get(META_SESSION);
  if (!sessionRow?.value) return null;

  const calendars = await calendarsCalendarsTable(db).toArray();
  const events = await calendarsEventsTable(db).toArray();
  const groups = (await calendarsGroupsTable(db).toArray()).sort(
    (left, right) => left.sortOrder - right.sortOrder,
  );
  if (calendars.length === 0 && events.length === 0) return null;

  return {
    session: JSON.parse(sessionRow.value) as CalendarAppBootstrap["session"],
    data: {
      calendars: calendars.map((row) => JSON.parse(row.data) as CalendarInfo),
      events: events.map((row) => JSON.parse(row.data) as JmapCalendarEvent),
      groups: groups.map((row) => JSON.parse(row.data) as CalendarDirectoryGroup),
    },
  };
}

export async function writeCalendarBootstrapToCache(
  username: string,
  bootstrap: CalendarAppBootstrap,
): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const events = calendarsEventsTable(db);
  const calendars = calendarsCalendarsTable(db);
  const groups = calendarsGroupsTable(db);
  const existingRows = await events.toArray();
  const incomingIds = new Set(bootstrap.data.events.map((event) => event.id));
  const keepRows = existingRows.filter(
    (row) => row.pendingSync || (row.locallyWritten === true && !incomingIds.has(row.id)),
  );
  await db.meta.put({ key: META_SESSION, value: JSON.stringify(bootstrap.session) });
  rememberOfflineCalendarsUsername(username);
  await calendars.clear();
  await calendars.bulkPut(
    bootstrap.data.calendars.map((calendar) => ({
      id: calendar.id,
      data: JSON.stringify(calendar),
    })),
  );
  await groups.clear();
  await groups.bulkPut(
    (bootstrap.data.groups ?? []).map((group, sortOrder) => ({
      slug: group.slug,
      sortOrder,
      data: JSON.stringify(group),
    })),
  );
  await events.clear();
  await events.bulkPut(bootstrap.data.events.map((event) => eventRow(event, false)));
  if (keepRows.length > 0) {
    await events.bulkPut(keepRows);
  }
}

export async function upsertCalendarEventInCache(
  username: string,
  event: JmapCalendarEvent,
  pendingSync = false,
  locallyWritten = true,
): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  await calendarsEventsTable(db).put(eventRow(event, pendingSync, locallyWritten));
}

export async function removeCalendarEventFromCache(
  username: string,
  eventId: string,
): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  await calendarsEventsTable(db).delete(eventId);
}

export async function upsertCalendarInCache(
  username: string,
  calendar: CalendarInfo,
): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  await calendarsCalendarsTable(db).put({
    id: calendar.id,
    data: JSON.stringify(calendar),
  });
}

export async function removeCalendarFromCache(username: string, calendarId: string): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  await calendarsCalendarsTable(db).delete(calendarId);
}

export async function listCachedEventsForCalendar(
  username: string,
  calendarId: string,
): Promise<OfflineCalendarEventRow[]> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  return calendarsEventsTable(db).where("calendarId").equals(calendarId).toArray();
}

export async function readCalendarSyncToken(
  username: string,
  scope: string,
): Promise<string | null> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const row = await db.meta.get(`${META_SYNC_TOKEN_PREFIX}${scope}`);
  return row?.value ?? null;
}

export async function writeCalendarSyncToken(
  username: string,
  scope: string,
  token: string,
): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  await db.meta.put({ key: `${META_SYNC_TOKEN_PREFIX}${scope}`, value: token });
}

export async function listFailedCalendarOutbox(username: string): Promise<OfflineOutboxRow[]> {
  const rows = await listOutboxMutationsForDomain(username, CALENDARS_DOMAIN);
  return rows.filter(isRetryableOutboxRow);
}

export async function listPendingCalendarEventIds(username: string): Promise<string[]> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const rows = await calendarsEventsTable(db)
    .filter((row) => row.pendingSync)
    .toArray();
  return rows.map((row) => row.id);
}

export function calendarsOutboxEventId(row: OfflineOutboxRow): string | null {
  if (row.domain !== CALENDARS_DOMAIN) return null;
  try {
    const payload = JSON.parse(row.payload) as {
      eventId?: string;
      tempEventId?: string;
      creationId?: string;
    };
    return payload.eventId ?? payload.tempEventId ?? payload.creationId ?? null;
  } catch {
    return null;
  }
}

export async function enqueueCoalescedCalendarEventUpdate(
  username: string,
  eventId: string,
  patch: CalendarEventPatch,
): Promise<void> {
  await enqueueCoalescedOutboxUpdate({
    username,
    domain: CALENDARS_DOMAIN,
    entityId: eventId,
    patch,
    ifInState: undefined,
    mergePatches: coalesceCalendarEventPatches,
    entityIdFromRow: calendarsOutboxEventId,
    buildUpdatePayload: (entityId, mergedPatch) => ({ eventId: entityId, patch: mergedPatch }),
    readPatchFromPayload: (payload) => payload.patch as CalendarEventPatch,
  });
}

export function createTempCalendarEventId(): string {
  return `local-${crypto.randomUUID().replace(/-/g, "")}`;
}

export function createTempCalendarId(): string {
  return `local-cal-${crypto.randomUUID().replace(/-/g, "")}`;
}
