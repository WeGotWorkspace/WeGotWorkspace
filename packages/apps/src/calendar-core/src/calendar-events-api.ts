import {
  EventsAPI,
  isThisInstanceOverride,
  resolveEventEnd,
  splitOccurrenceKey,
  type ApplyResult,
  type CalendarEvent,
  type CalendarEventsMap,
  type CalendarsMap,
  type EventOperation,
} from "@/lib/calendar-engine";
import type { EventsAPIContextValue } from "@/lib/calendar-elements/context/EventsAPIContext";
import { createTempCalendarEventId } from "@/lib/offline/calendars-offline-store";
import {
  engineEventToForm,
  formToDraft,
  formToFullPatch,
} from "@/calendar-core/src/calendar-editor-model";
import { recurrenceOverridesFromEngineMap } from "@/calendar-core/src/calendar-recurrence-scope";
import { canWriteCalendarCollection } from "@/calendar-core/src/calendar-collection-write";
import type {
  CalendarAPIOperations,
  CalendarEventPatch,
  CalendarInfo,
} from "@/calendar-core/src/calendar-types";

const OFFLINE_ACCOUNT_ID = "offline";

export function calendarInfosToEngineMap(calendars: readonly CalendarInfo[]): CalendarsMap {
  const map: CalendarsMap = new Map();
  for (const calendar of calendars) {
    map.set(calendar.id, {
      accountId: OFFLINE_ACCOUNT_ID,
      url: `/calendars/${calendar.id}`,
      displayName: calendar.name,
      color: calendar.color,
      isVisible: calendar.isVisible !== false,
      isDefault: calendar.isDefault === true,
      ...(typeof calendar.sortOrder === "number" ? { sortOrder: calendar.sortOrder } : {}),
      myRights: {
        mayWriteAll: canWriteCalendarCollection(calendar),
        mayWriteOwn: canWriteCalendarCollection(calendar),
        ...(typeof calendar.mayShare === "boolean" ? { mayShare: calendar.mayShare } : {}),
        ...(typeof calendar.mayDelete === "boolean" ? { mayDelete: calendar.mayDelete } : {}),
      },
    });
  }
  return map;
}

function eventForTarget(
  events: CalendarEventsMap,
  target: { key: string } | { eventId: string; calendarId?: string },
): CalendarEvent | undefined {
  if ("key" in target) {
    return events.get(target.key) ?? events.get(persistEventId(target.key));
  }
  return (
    events.get(target.eventId) ??
    [...events.values()].find((event) => event.eventId === target.eventId)
  );
}

function operationCalendarIds(operation: EventOperation, events: CalendarEventsMap): string[] {
  const ids = new Set<string>();
  if (operation.type === "create") {
    if (operation.input.event.calendarId) ids.add(operation.input.event.calendarId);
    return [...ids];
  }
  const target = "target" in operation.input ? operation.input.target : undefined;
  if (!target) return [];
  if ("calendarId" in target && target.calendarId) ids.add(target.calendarId);
  const event = eventForTarget(events, target);
  if (event?.calendarId) ids.add(event.calendarId);
  if (operation.type === "update" && operation.input.patch.calendarId) {
    ids.add(operation.input.patch.calendarId);
  }
  return [...ids];
}

function blocksCollectionWrite(
  operation: EventOperation,
  events: CalendarEventsMap,
  calendars: readonly CalendarInfo[],
): boolean {
  return operationCalendarIds(operation, events).some((id) => {
    const calendar = calendars.find((entry) => entry.id === id);
    return calendar != null && !canWriteCalendarCollection(calendar);
  });
}

/** Engine map key / offline persist id. Occurrence keys are `${id}::${recurrenceId}`. */
export function persistEventId(key: string): string {
  return splitOccurrenceKey(key).masterId;
}

/**
 * Week/TimeLine drag resolves `envelope.eventId` against the map key first.
 * Offline rows must keep `eventId` aligned with that key (not a JSCalendar uid).
 */
export function alignOfflineEventIds(events: CalendarEventsMap): CalendarEventsMap {
  const next: CalendarEventsMap = new Map();
  let changed = false;
  for (const [key, event] of events) {
    const persistId = persistEventId(key);
    if (event.eventId === persistId) {
      next.set(key, event);
      continue;
    }
    changed = true;
    next.set(key, { ...event, eventId: persistId });
  }
  return changed ? next : events;
}

/** Pending deletes stay in the engine map; the surface must not paint those cards. */
export function omitPendingDeletedEvents(events: CalendarEventsMap): CalendarEventsMap {
  let changed = false;
  const next: CalendarEventsMap = new Map();
  for (const [key, event] of events) {
    if (event.pendingOp === "deleted") {
      changed = true;
      continue;
    }
    next.set(key, event);
  }
  return changed ? next : events;
}

function isTempPersistId(id: string): boolean {
  return id.startsWith("local-");
}

function sameEventSlot(left: CalendarEvent, right: CalendarEvent): boolean {
  return (
    left.calendarId === right.calendarId &&
    left.data.start.toString() === right.data.start.toString() &&
    resolveEventEnd(left.data).toString() === resolveEventEnd(right.data).toString()
  );
}

function sameEventTitle(left: CalendarEvent, right: CalendarEvent): boolean {
  return (left.data.summary ?? "") === (right.data.summary ?? "");
}

function isOptimisticOverlay(key: string, event: CalendarEvent): boolean {
  return (
    isTempPersistId(persistEventId(key)) ||
    event.pendingOp === "created" ||
    event.pendingOp === "updated"
  );
}

/** Same calendar + slot, or a pending edit that still matches title after a move. */
function sameLogicalEvent(source: CalendarEvent, cached: CalendarEvent): boolean {
  if (source.calendarId !== cached.calendarId) return false;
  const sameSlot = sameEventSlot(source, cached);
  const sameTitle = sameEventTitle(source, cached);
  if (sameSlot && sameTitle) return true;
  return source.pendingOp === "updated" && (sameSlot || sameTitle);
}

/**
 * True when cache already has the remapped server row for an optimistic
 * overlay key (`local-…` or a pending patched engine id).
 */
export function liveHasRemappedOptimisticEvent(
  sourceKey: string,
  source: CalendarEvent,
  cache: CalendarEventsMap,
): boolean {
  return remappedOptimisticCacheKey(sourceKey, source, cache) !== undefined;
}

function remappedOptimisticCacheKey(
  sourceKey: string,
  source: CalendarEvent,
  cache: CalendarEventsMap,
): string | undefined {
  if (!isOptimisticOverlay(sourceKey, source)) return undefined;
  const sourceId = persistEventId(sourceKey);
  const sourceIsOccurrence = Boolean(splitOccurrenceKey(sourceKey).recurrenceId);
  for (const [cacheKey, cached] of cache) {
    if (cacheKey === sourceKey || persistEventId(cacheKey) === sourceId) continue;
    if (isTempPersistId(persistEventId(cacheKey))) continue;
    if (Boolean(splitOccurrenceKey(cacheKey).recurrenceId) !== sourceIsOccurrence) continue;
    if (sameLogicalEvent(source, cached)) return cacheKey;
  }
  return undefined;
}

function omitRemappedOptimisticDuplicates(events: CalendarEventsMap): CalendarEventsMap {
  const drop: string[] = [];
  for (const [key, event] of events) {
    if (!isTempPersistId(persistEventId(key))) continue;
    if (remappedOptimisticCacheKey(key, event, events)) drop.push(key);
  }
  if (drop.length === 0) return events;
  const next = new Map(events);
  for (const key of drop) next.delete(key);
  return next;
}

function applyOverlayOntoKey(
  next: CalendarEventsMap,
  key: string,
  event: CalendarEvent,
  cached: CalendarEvent | undefined,
): void {
  if (event.pendingOp === "deleted") {
    next.delete(key);
    return;
  }
  if (event.pendingOp && cached && !sameEventSlot(event, cached)) {
    next.set(key, { ...event, eventId: persistEventId(key) });
  }
}

/**
 * Cache/bootstrap rows win on shared keys (dialog title patch). Keep an
 * in-flight overlay move/resize when the cache is still at the pre-drag slot
 * — otherwise dragend snaps back to Dexie, then forward after persist.
 * Overlay-only local- creates stay until they land in the cache. A remapped
 * server id with the same identity replaces the pre-flush key so reconnect
 * never paints two cards.
 */
export function mergeOfflineCacheEvents(
  overlay: CalendarEventsMap | undefined,
  cache: CalendarEventsMap,
): CalendarEventsMap {
  if (cache.size === 0 && overlay && overlay.size > 0) {
    return new Map(overlay);
  }
  const next: CalendarEventsMap = omitRemappedOptimisticDuplicates(new Map(cache));
  if (!overlay) return next;
  for (const [key, event] of overlay) {
    const cached = next.get(key);
    if (cached) {
      applyOverlayOntoKey(next, key, event, cached);
      continue;
    }
    const remappedKey = remappedOptimisticCacheKey(key, event, next);
    if (remappedKey) {
      applyOverlayOntoKey(next, remappedKey, event, next.get(remappedKey));
      continue;
    }
    const persistId = persistEventId(key);
    if (isTempPersistId(persistId) || event.pendingOp === "created") {
      next.set(key, event);
    }
  }
  return next;
}

function stabilizeCreateOperation(operation: EventOperation): EventOperation {
  if (operation.type !== "create") return operation;
  const existing = operation.input.key ?? operation.input.event.eventId;
  const tempId = existing ?? createTempCalendarEventId();
  return {
    type: "create",
    input: {
      ...operation.input,
      key: tempId,
      event: { ...operation.input.event, eventId: tempId },
    },
  };
}

function remapOverlayKeys(
  events: CalendarEventsMap,
  remaps: ReadonlyMap<string, string>,
): CalendarEventsMap {
  if (remaps.size === 0) return events;
  const next = new Map(events);
  for (const [from, to] of remaps) {
    if (from === to) continue;
    const event = next.get(from);
    if (!event) continue;
    next.delete(from);
    next.set(to, { ...event, eventId: to });
  }
  return next;
}

function patchFromEngineEvent(
  events: CalendarEventsMap,
  masterKey: string,
  event: CalendarEvent,
): CalendarEventPatch {
  const patch = formToFullPatch(engineEventToForm(event));
  const overrides = recurrenceOverridesFromEngineMap(events, persistEventId(masterKey));
  if (overrides) patch.recurrenceOverrides = overrides;
  return patch;
}

/**
 * Persist this-instance rows as master `recurrenceOverrides`, never a second
 * CalendarEvent. Use the occurrence key (`::`) as well as
 * `isThisInstanceOverride` — consolidation missed `::` rows that are not
 * flagged as detached (second move then patched the series start / dropped
 * the original rid and the series slot came back).
 */
function persistAsSeriesOverride(events: CalendarEventsMap, key: string): boolean {
  return Boolean(splitOccurrenceKey(key).recurrenceId) || isThisInstanceOverride(events, key);
}

export async function persistCalendarEventChanges(
  operations: CalendarAPIOperations,
  result: ApplyResult,
): Promise<Map<string, string>> {
  const remaps = new Map<string, string>();
  for (const change of result.changes) {
    // Detached exceptions persist as JSCalendar recurrenceOverrides on the master
    // — never as a second CalendarEvent (that paints the original + the override).
    if (persistAsSeriesOverride(result.nextState, change.key)) {
      const masterKey = persistEventId(change.key);
      const masterAlsoWritten = result.changes.some(
        (entry) => entry.key === masterKey && entry.type !== "removed",
      );
      if (masterAlsoWritten || change.type === "removed") continue;
      const overrides = recurrenceOverridesFromEngineMap(result.nextState, masterKey);
      if (overrides) {
        await operations.patchEvent(masterKey, { recurrenceOverrides: overrides });
      }
      continue;
    }
    if (change.type === "created") {
      const draft = formToDraft(engineEventToForm(change.event));
      if (!draft.calendarId) continue;
      const persistId = persistEventId(change.key);
      const created = await operations.createEvent({
        ...draft,
        ...(persistId.startsWith("local-") ? { id: persistId } : {}),
      });
      if (created.id && created.id !== change.key) {
        remaps.set(change.key, created.id);
      }
      continue;
    }
    if (change.type === "updated") {
      const eventId = persistEventId(change.key);
      if (change.after.pendingOp === "deleted") {
        await operations.deleteEvent(eventId);
        continue;
      }
      await operations.patchEvent(
        eventId,
        patchFromEngineEvent(result.nextState, change.key, change.after),
      );
      continue;
    }
    await operations.deleteEvent(persistEventId(change.key));
  }
  return remaps;
}

export type CreateCalendarEventsApiArgs = {
  getEvents: () => CalendarEventsMap;
  calendars: readonly CalendarInfo[];
  operations: CalendarAPIOperations;
  selectedCalendarId?: string;
  visibleCalendarIds?: string[];
  onEventsChanged?: (events: CalendarEventsMap) => void;
  onPersisted?: () => void;
  /** Local remove — keep this id suppressed if a stale bootstrap snapshot still has it. */
  onEventDeleted?: (eventId: string) => void;
};

export type CalendarEventsApi = EventsAPIContextValue & {
  /** Replace/merge working set from a Dexie/bootstrap refresh (dialog patch, create persist). */
  replaceEvents: (cacheEvents: CalendarEventsMap) => void;
};

/** Lit EventsAPI: engine apply + hybrid Dexie/outbox persist. Same API online and offline. */
export function createCalendarEventsApi(args: CreateCalendarEventsApiArgs): CalendarEventsApi {
  let overlay: CalendarEventsMap | undefined;
  const calendars = calendarInfosToEngineMap(args.calendars);

  const currentEvents = () => omitPendingDeletedEvents(overlay ?? args.getEvents());
  let persistQueue = Promise.resolve();

  const publishOverlay = (next: CalendarEventsMap) => {
    overlay = alignOfflineEventIds(next);
    args.onEventsChanged?.(overlay);
  };

  const apply = (operation: EventOperation): ApplyResult => {
    if (blocksCollectionWrite(operation, currentEvents(), args.calendars)) {
      return { nextState: currentEvents(), changes: [], effects: [] };
    }
    const api = new EventsAPI(currentEvents(), { trackPending: true });
    const result = api.apply(stabilizeCreateOperation(operation));
    publishOverlay(result.nextState);
    for (const change of result.changes) {
      if (change.type === "removed") {
        args.onEventDeleted?.(persistEventId(change.key));
      } else if (change.type === "updated" && change.after.pendingOp === "deleted") {
        args.onEventDeleted?.(persistEventId(change.key));
      }
    }
    persistQueue = persistQueue
      .then(() => persistCalendarEventChanges(args.operations, result))
      .then((remaps) => {
        if (remaps.size > 0) {
          publishOverlay(remapOverlayKeys(overlay ?? args.getEvents(), remaps));
        }
        args.onPersisted?.();
      })
      .catch(() => undefined);
    return { ...result, nextState: overlay ?? result.nextState };
  };

  return {
    getEvents: () => currentEvents(),
    getCalendars: () => calendars,
    getCalendarAccounts: () => new Set([OFFLINE_ACCOUNT_ID]),
    getVisibleCalendarIds: () => args.visibleCalendarIds,
    getSelectedCalendarId: () => {
      if (args.selectedCalendarId) return args.selectedCalendarId;
      for (const calendar of args.calendars) {
        if (calendar.isDefault) return calendar.id;
      }
      return args.calendars[0]?.id;
    },
    apply,
    getApi: () => new EventsAPI(currentEvents(), { trackPending: true }),
    create: (input) => apply({ type: "create", input }),
    update: (input) => apply({ type: "update", input }),
    move: (input) => apply({ type: "move", input }),
    resizeStart: (input) => apply({ type: "resize-start", input }),
    resizeEnd: (input) => apply({ type: "resize-end", input }),
    remove: (input) => apply({ type: "remove", input }),
    addExclusion: (input) => apply({ type: "add-exclusion", input }),
    removeExclusion: (input) => apply({ type: "remove-exclusion", input }),
    addException: (input) => apply({ type: "add-exception", input }),
    removeException: (input) => apply({ type: "remove-exception", input }),
    replaceEvents: (cacheEvents) => {
      // Prefer the in-memory overlay; after a bootstrap refresh the API is
      // recreated (`overlay` is empty) but getEvents() still holds the working set.
      publishOverlay(mergeOfflineCacheEvents(overlay ?? args.getEvents(), cacheEvents));
    },
  };
}
