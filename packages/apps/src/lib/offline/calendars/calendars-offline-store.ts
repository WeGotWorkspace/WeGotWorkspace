import type { CalendarAppBootstrap } from "@/lib/api/mock/calendar-bootstrap";
import type { JmapCalendarEvent } from "@/lib/jmap-client";
import type {
  CalendarDirectoryGroup,
  CalendarEventPatch,
  CalendarInfo,
} from "@/lib/models/calendar-types";
import { rememberOfflineCalendarsUsername } from "@/lib/offline/core/offline-session";
import {
  offlineAccountKeyFromUsername,
  offlineDbForAccount,
  type WgwOfflineDatabase,
} from "@/lib/offline/core/offline-db";
import {
  parseMirrorRows,
  readMirrorSession,
  replaceMirrorRows,
  writeMirrorSession,
} from "@/lib/offline/core/mirror-cache";
import {
  isSyncNoticeOutboxRow,
  listOutboxMutationsForDomain,
} from "@/lib/offline/core/outbox-store";
import { enqueueCoalescedOutboxUpdate } from "@/lib/offline/core/outbox-coalescing";
import { createLocalEntityId, outboxEntityIdReader } from "@/lib/offline/core/outbox-entity-id";
import type { OfflineOutboxRow } from "@/lib/offline/core/types";
import {
  CALENDARS_DOMAIN,
  calendarsCalendarsTable,
  calendarsEventsTable,
  calendarsGroupsTable,
  type OfflineCalendarEventRow,
} from "@/lib/offline/calendars/calendars-schema";
import { coalesceCalendarEventPatches } from "@/lib/offline/calendars/calendars-patch-merge";
import { rangeQueryCoversEvent, type CalendarUtcRange } from "@/lib/calendar-load-window";

export {
  enqueueOutboxMutation,
  listOutboxMutations,
  markOutboxError,
  removeOutboxMutation,
} from "@/lib/offline/core/outbox-store";

const META_SESSION = "calendars:session";
const META_GROUPS_LOADED = "calendars:groups-loaded";
const META_SYNC_TOKEN_PREFIX = "calendars:sync:";
/** One `meta` row per recently removed event: the key ends in its id, the value is when. */
const META_REMOVED_EVENT_PREFIX = "calendars:removed-event:";

/**
 * How long a removed event is remembered, so a snapshot requested before the
 * removal cannot bring it back (#2256). A load takes seconds; this is ample.
 */
const REMOVED_EVENT_MEMORY_MS = 10 * 60_000;

function eventCalendarId(event: JmapCalendarEvent): string {
  return Object.keys(event.calendarIds ?? {})[0] ?? "";
}

function eventRow(
  event: JmapCalendarEvent,
  pendingSync: boolean,
  locallyWritten = false,
  updatedAt = Date.now(),
): OfflineCalendarEventRow {
  return {
    id: event.id,
    calendarId: eventCalendarId(event),
    data: JSON.stringify(event),
    pendingSync,
    updatedAt,
    ...(locallyWritten ? { locallyWritten: true } : {}),
  };
}

export async function readCalendarBootstrapFromCache(
  username: string,
): Promise<CalendarAppBootstrap | null> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const session = await readMirrorSession<CalendarAppBootstrap["session"]>(db, META_SESSION);
  if (!session) return null;

  const calendars = await calendarsCalendarsTable(db).toArray();
  const events = await calendarsEventsTable(db).toArray();
  const groups = (await calendarsGroupsTable(db).toArray()).sort(
    (left, right) => left.sortOrder - right.sortOrder,
  );
  if (calendars.length === 0 && events.length === 0) return null;
  // An empty table only means "no Team" once a groups load completed; otherwise
  // the Teams are unknown and must not be written back as [].
  const groupsLoaded = groups.length > 0 || (await db.meta.get(META_GROUPS_LOADED)) !== undefined;

  return {
    session,
    data: {
      calendars: parseMirrorRows<CalendarInfo>(calendars),
      events: parseMirrorRows<JmapCalendarEvent>(events),
      groups: groupsLoaded ? parseMirrorRows<CalendarDirectoryGroup>(groups) : undefined,
    },
  };
}

/**
 * A snapshot (the first load, or one period) can be seconds old when it is
 * written. What the cache stored in the meantime is newer than the snapshot
 * and wins (#2256): an inbound sync round of this tab or another one, or a
 * snapshot that was requested later.
 */
export type CalendarSnapshotWriteOptions = {
  /**
   * When the snapshot was requested from the server, or read from the cache
   * for a rewrite (epoch ms, taken before the request). A row written after
   * that moment is not replaced or dropped, and an event removed after it is
   * not brought back. Without it the snapshot counts as current.
   */
  requestedAt?: number;
};

type RemovedEvents = ReadonlyMap<string, number>;

/**
 * When each recently removed event was removed; forgets the ones older than
 * {@link REMOVED_EVENT_MEMORY_MS}. Runs inside the caller's transaction.
 */
async function readRemovedEvents(db: WgwOfflineDatabase): Promise<RemovedEvents> {
  const rows = await db.meta.where("key").startsWith(META_REMOVED_EVENT_PREFIX).toArray();
  const forgetBefore = Date.now() - REMOVED_EVENT_MEMORY_MS;
  const expired = rows.filter((row) => Number(row.value) < forgetBefore).map((row) => row.key);
  if (expired.length > 0) await db.meta.bulkDelete(expired);
  return new Map(
    rows.map((row) => [row.key.slice(META_REMOVED_EVENT_PREFIX.length), Number(row.value)]),
  );
}

/** True when the snapshot is older than the removal of `id`. */
function removedSince(removed: RemovedEvents, id: string, requestedAt: number): boolean {
  return (removed.get(id) ?? 0) > requestedAt;
}

export type CalendarBootstrapCacheWriteOptions = CalendarSnapshotWriteOptions & {
  /**
   * The bootstrap window the snapshot's events cover (#1675). A cached event
   * the snapshot omits is dropped only when the window certainly covers it, or
   * its calendar is gone. Others came from a period loaded on demand and stay.
   * Without it, every omitted event is dropped.
   */
  window?: CalendarUtcRange;
  /**
   * The bootstrap is a copy of the cache (a calendar-list edit, a subscription
   * refresh), not a server snapshot. `requestedAt` is then only the fence for
   * rows stored meanwhile; a copied row keeps its own `updatedAt`, because the
   * rewrite adds no information a snapshot requested earlier could lack. The
   * events are not written at all: the cache is the truth, and only the events
   * of a calendar the copy dropped are removed.
   */
  rewrite?: boolean;
};

function keepCachedRowOnBootstrapWrite(
  row: OfflineCalendarEventRow,
  incomingIds: ReadonlySet<string>,
  calendarIds: ReadonlySet<string>,
  window: CalendarUtcRange | undefined,
  requestedAt: number,
): boolean {
  if (row.pendingSync) return true;
  if (row.updatedAt > requestedAt) return true;
  if (incomingIds.has(row.id)) return false;
  if (row.locallyWritten === true) return true;
  if (!window || !calendarIds.has(row.calendarId)) return false;
  return !rangeQueryCoversEvent(parseEventRow(row), window);
}

function parseEventRow(row: OfflineCalendarEventRow): JmapCalendarEvent {
  return JSON.parse(row.data) as JmapCalendarEvent;
}

export async function writeCalendarBootstrapToCache(
  username: string,
  bootstrap: CalendarAppBootstrap,
  options: CalendarBootstrapCacheWriteOptions = {},
): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const events = calendarsEventsTable(db);
  const calendars = calendarsCalendarsTable(db);
  const groups = calendarsGroupsTable(db);
  await writeMirrorSession(db, META_SESSION, bootstrap.session);
  rememberOfflineCalendarsUsername(username);
  await replaceMirrorRows(
    calendars,
    bootstrap.data.calendars.map((calendar) => ({
      id: calendar.id,
      data: JSON.stringify(calendar),
    })),
  );
  // Unknown Teams (failed load) keep the cached list instead of reading as "no Team".
  if (bootstrap.data.groups !== undefined) {
    await replaceMirrorRows(
      groups,
      bootstrap.data.groups.map((group, sortOrder) => ({
        slug: group.slug,
        sortOrder,
        data: JSON.stringify(group),
      })),
    );
    await db.meta.put({ key: META_GROUPS_LOADED, value: "1" });
  }
  const requestedAt = options.requestedAt ?? Date.now();
  // One transaction: a period loaded on demand must not land between the read
  // and the clear and then be lost.
  await db.transaction("rw", events, db.meta, async () => {
    const removed = await readRemovedEvents(db);
    const incoming = bootstrap.data.events.filter(
      (event) => !removedSince(removed, event.id, requestedAt),
    );
    const incomingIds = new Set(incoming.map((event) => event.id));
    const calendarIds = new Set(bootstrap.data.calendars.map((calendar) => calendar.id));
    if (options.rewrite) {
      // A copy of the cache can be older than what the cache stores now. The
      // stored rows stay as they are; only the events of a calendar the copy no
      // longer lists go, unless a newer or local row says otherwise.
      const gone = (await events.toArray())
        .filter(
          (row) =>
            !calendarIds.has(row.calendarId) &&
            !row.pendingSync &&
            row.locallyWritten !== true &&
            row.updatedAt <= requestedAt,
        )
        .map((row) => row.id);
      if (gone.length > 0) await events.bulkDelete(gone);
      return;
    }
    await replaceMirrorRows(
      events,
      incoming.map((event) => eventRow(event, false, false, requestedAt)),
      {
        keep: (row) =>
          keepCachedRowOnBootstrapWrite(row, incomingIds, calendarIds, options.window, requestedAt),
      },
    );
  });
}

/**
 * Merge one on-demand period into the cache (#1675): upsert what the server
 * returned and drop cached events the query covers but no longer returned.
 * The query returns a series when one of its occurrences falls in the
 * period, so an omitted master with an occurrence there is gone on the
 * server; one with no occurrence there stays. This is the only place a
 * series deleted while the client was closed, which never occurs in the
 * bootstrap window, is removed. Rows with a pending or just-written local
 * change stay, and so does what the cache stored after the period was
 * requested (see {@link CalendarSnapshotWriteOptions}).
 */
export async function mergeCalendarRangeIntoCache(
  username: string,
  range: CalendarUtcRange,
  incoming: readonly JmapCalendarEvent[],
  options: CalendarSnapshotWriteOptions = {},
): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const events = calendarsEventsTable(db);
  const requestedAt = options.requestedAt ?? Date.now();
  await db.transaction("rw", events, db.meta, async () => {
    const existing = await events.toArray();
    const removed = await readRemovedEvents(db);
    const incomingIds = new Set(incoming.map((event) => event.id));
    // Rows the period must leave alone: a pending local change, or newer than the period.
    const keptIds = new Set(
      existing.filter((row) => row.pendingSync || row.updatedAt > requestedAt).map((row) => row.id),
    );
    const goneIds = existing
      .filter(
        (row) =>
          !keptIds.has(row.id) &&
          row.locallyWritten !== true &&
          !incomingIds.has(row.id) &&
          rangeQueryCoversEvent(parseEventRow(row), range),
      )
      .map((row) => row.id);
    if (goneIds.length > 0) {
      await events.bulkDelete(goneIds);
    }
    await events.bulkPut(
      incoming
        .filter((event) => !keptIds.has(event.id) && !removedSince(removed, event.id, requestedAt))
        .map((event) => eventRow(event, false, false, requestedAt)),
    );
  });
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

/**
 * Stores one event of a snapshot that was requested at `requestedAt` (the
 * window an open tab loads for inbound sync). The cache wins when its row has
 * a pending local change (`pending`) or is newer than the snapshot (`newer`,
 * see {@link CalendarSnapshotWriteOptions}). It reads one row, not the table:
 * a window load calls this once per event.
 */
export async function upsertSnapshotCalendarEventInCache(
  username: string,
  event: JmapCalendarEvent,
  requestedAt: number,
): Promise<"stored" | "pending" | "newer"> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const events = calendarsEventsTable(db);
  return db.transaction("rw", events, db.meta, async () => {
    const cached = await events.get(event.id);
    if (cached?.pendingSync) return "pending";
    if (cached && cached.updatedAt > requestedAt) return "newer";
    const removedAt = await db.meta.get(`${META_REMOVED_EVENT_PREFIX}${event.id}`);
    if (Number(removedAt?.value ?? 0) > requestedAt) return "newer";
    await events.put(eventRow(event, false, false, requestedAt));
    return "stored";
  });
}

/**
 * Removes the event and remembers the removal for a while, so a snapshot that
 * was requested earlier and still lists the event does not bring it back.
 */
export async function removeCalendarEventFromCache(
  username: string,
  eventId: string,
): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const events = calendarsEventsTable(db);
  await db.transaction("rw", events, db.meta, async () => {
    await events.delete(eventId);
    await db.meta.put({
      key: `${META_REMOVED_EVENT_PREFIX}${eventId}`,
      value: String(Date.now()),
    });
  });
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
  return rows.filter(isSyncNoticeOutboxRow);
}

export async function listPendingCalendarEventIds(username: string): Promise<string[]> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const rows = await calendarsEventsTable(db)
    .filter((row) => row.pendingSync)
    .toArray();
  return rows.map((row) => row.id);
}

export const calendarsOutboxEventId = outboxEntityIdReader(CALENDARS_DOMAIN, [
  "eventId",
  "tempEventId",
  "creationId",
]);

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

/**
 * Drops an event that only exists on this device: its queued create and every queued edit
 * of it, plus the cached copy. Returns false (and changes nothing) when no create is
 * queued, so the event is on the server and needs a real delete. Undo of an offline
 * create then leaves no row behind, instead of a delete the server cannot match (#1854).
 */
export async function discardUnsentCalendarEvent(
  username: string,
  eventId: string,
): Promise<boolean> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  return db.transaction("rw", [db.outbox, calendarsEventsTable(db)], async () => {
    const rows = await db.outbox.where("domain").equals(CALENDARS_DOMAIN).toArray();
    const own = rows.filter((row) => calendarsOutboxEventId(row) === eventId);
    if (!own.some((row) => row.op === "create")) return false;
    await db.outbox.bulkDelete(own.map((row) => row.id));
    await calendarsEventsTable(db).delete(eventId);
    return true;
  });
}

export function createTempCalendarEventId(): string {
  return createLocalEntityId();
}

export function createTempCalendarId(): string {
  return createLocalEntityId("local-cal-");
}
