import { Temporal } from "@js-temporal/polyfill";
import {
  type CalendarEvent,
  type CalendarEventData,
  resolveEventEnd,
  toIANATimeZone,
} from "@/lib/calendar-engine";
import type { JmapCalendarEvent } from "../calendars/types.js";
import type {
  JSCalendarEvent,
  JSCalendarLocalDateTime,
  JSCalendarLocation,
  JSCalendarPatchObject,
} from "../jscalendar/types.js";
import {
  durationToJs,
  internalRecurrenceIdToLocal,
  jsToDuration,
  localToInternalRecurrenceId,
  localToPlainDateTime,
  plainDateTimeToLocal,
} from "./datetime.js";
import { internalRecurrenceRuleToJs, jsRecurrenceRuleToInternal } from "./recurrence.js";

export type InternalEventRow = { key: string; event: CalendarEvent };

/** One logical JMAP event as internal rows: the master plus detached exception rows. */
export type InternalEventGroup = {
  masterKey: string;
  master: CalendarEvent;
  /** Detached exception rows keyed by internal recurrence id. */
  exceptions: Map<string, CalendarEvent>;
};

/**
 * Override patch keys this mapping owns. Keys outside this set (alerts, participants, …)
 * are preserved opaquely by merging onto the original wire object at serialize time.
 */
const MANAGED_PATCH_KEYS = new Set([
  "excluded",
  "title",
  "start",
  "duration",
  "showWithoutTime",
  "timeZone",
  "color",
  "locations",
]);

function isManagedPatchKey(key: string): boolean {
  return MANAGED_PATCH_KEYS.has(key) || key.startsWith("locations/");
}

function firstLocationKey(locations: Record<string, JSCalendarLocation>): string | undefined {
  return Object.keys(locations).sort()[0];
}

function primaryLocationName(event: JSCalendarEvent): string | undefined {
  const locations = event.locations;
  if (!locations) return undefined;
  const key = firstLocationKey(locations);
  return key ? locations[key]?.name : undefined;
}

function resolveDuration(data: CalendarEventData): Temporal.Duration {
  const end = resolveEventEnd(data);
  return data.start.until(end, { largestUnit: "days" });
}

/**
 * JSCalendar Event uses `duration` (RFC 8984). Our API also emits `end` when
 * CalDAV ICS has DTEND (Apple Calendar, etc.). Prefer explicit duration; else
 * derive from start→end so timed events are not mapped as PT0S (invisible).
 */
export function durationFromJmapEvent(
  jmapEvent: Pick<JSCalendarEvent, "start" | "duration" | "showWithoutTime"> & {
    end?: unknown;
  },
): Temporal.Duration {
  if (typeof jmapEvent.duration === "string" && jmapEvent.duration.trim() !== "") {
    return jsToDuration(jmapEvent.duration);
  }
  const endRaw = jmapEvent.end;
  if (typeof endRaw === "string" && endRaw.trim() !== "") {
    try {
      const start = localToPlainDateTime(jmapEvent.start);
      const end = localToPlainDateTime(endRaw);
      const derived = start.until(end, { largestUnit: "days" });
      if (derived.total({ unit: "seconds" }) > 0) {
        return derived;
      }
    } catch {
      // fall through to default
    }
  }
  return jsToDuration(jmapEvent.showWithoutTime === true ? "P1D" : "PT0S");
}

function durationFromPatch(
  patch: JSCalendarPatchObject,
  occurrenceStart: Temporal.PlainDateTime,
  fallback: Temporal.Duration,
): Temporal.Duration {
  if (typeof patch.duration === "string" && patch.duration.trim() !== "") {
    return jsToDuration(patch.duration);
  }
  if (typeof patch.end === "string" && patch.end.trim() !== "") {
    try {
      const end = localToPlainDateTime(patch.end);
      const start =
        typeof patch.start === "string" && patch.start.trim() !== ""
          ? localToPlainDateTime(patch.start)
          : occurrenceStart;
      const derived = start.until(end, { largestUnit: "days" });
      if (derived.total({ unit: "seconds" }) > 0) {
        return derived;
      }
    } catch {
      // fall through
    }
  }
  return fallback;
}

function isExcludedPatch(patch: JSCalendarPatchObject): boolean {
  return patch.excluded === true;
}

/**
 * Converts one JMAP CalendarEvent (JSCalendar) into internal rows: a master row keyed by
 * `masterKey` (defaults to the JMAP id) plus one `${masterKey}::${recurrenceId}` row per
 * overridden occurrence, mirroring the events-api detached-exception convention.
 */
export function jmapEventToInternalRows(
  jmapEvent: JmapCalendarEvent,
  options: { accountId?: string; masterKey?: string } = {},
): InternalEventRow[] {
  try {
    return mapJmapEventToInternalRows(jmapEvent, options);
  } catch (error) {
    console.warn("[jmap] skipped unmappable calendar event", jmapEvent.id ?? jmapEvent.uid, error);
    return [];
  }
}

function mapJmapEventToInternalRows(
  jmapEvent: JmapCalendarEvent,
  options: { accountId?: string; masterKey?: string },
): InternalEventRow[] {
  const masterKey = options.masterKey ?? jmapEvent.id;
  const allDay = jmapEvent.showWithoutTime === true;
  const start = localToPlainDateTime(jmapEvent.start);
  const duration = durationFromJmapEvent(jmapEvent);
  const timeZone = jmapEvent.timeZone
    ? (toIANATimeZone(jmapEvent.timeZone) ?? undefined)
    : undefined;
  const calendarId = Object.keys(jmapEvent.calendarIds ?? {})[0];
  const recurrenceRule = jmapEvent.recurrenceRules?.length
    ? jsRecurrenceRuleToInternal(jmapEvent.recurrenceRules[0])
    : undefined;

  const exclusionDates = new Set<string>();
  const overrideEntries: Array<[JSCalendarLocalDateTime, JSCalendarPatchObject]> = [];
  for (const [rid, patch] of Object.entries(jmapEvent.recurrenceOverrides ?? {})) {
    // JMAP remove-nulls (and corrupt entries) must not become detached rows.
    if (!patch || typeof patch !== "object") continue;
    if (isExcludedPatch(patch)) {
      exclusionDates.add(localToInternalRecurrenceId(rid, allDay));
    } else {
      overrideEntries.push([rid, patch]);
    }
  }

  const masterData: CalendarEventData = {
    start,
    duration,
    ...(allDay ? { allDay: true } : {}),
    ...(timeZone ? { timeZone } : {}),
    summary: jmapEvent.title ?? "",
    ...(jmapEvent.color ? { color: jmapEvent.color } : {}),
    ...(primaryLocationName(jmapEvent) ? { location: primaryLocationName(jmapEvent) } : {}),
    ...(recurrenceRule ? { recurrenceRule } : {}),
    ...(exclusionDates.size ? { exclusionDates } : {}),
  };

  const master: CalendarEvent = {
    ...(options.accountId ? { accountId: options.accountId } : {}),
    ...(calendarId ? { calendarId } : {}),
    eventId: jmapEvent.uid,
    ...(recurrenceRule ? { isRecurring: true } : {}),
    data: masterData,
  };

  const rows: InternalEventRow[] = [{ key: masterKey, event: master }];

  for (const [rid, patch] of overrideEntries) {
    const internalRid = localToInternalRecurrenceId(rid, allDay);
    const occurrenceStart = localToPlainDateTime(rid);
    const data: CalendarEventData = {
      start:
        patch.start !== undefined ? localToPlainDateTime(patch.start as string) : occurrenceStart,
      duration: durationFromPatch(patch, occurrenceStart, duration),
      ...((patch.showWithoutTime ?? allDay) ? { allDay: true } : {}),
      ...(timeZone || patch.timeZone
        ? {
            timeZone:
              patch.timeZone !== undefined
                ? (toIANATimeZone(patch.timeZone as string) ?? undefined)
                : timeZone,
          }
        : {}),
      summary: patch.title !== undefined ? (patch.title as string) : (jmapEvent.title ?? ""),
      ...(resolvePatchColor(patch, jmapEvent)
        ? { color: resolvePatchColor(patch, jmapEvent) }
        : {}),
      ...(resolvePatchLocation(patch, jmapEvent)
        ? { location: resolvePatchLocation(patch, jmapEvent) }
        : {}),
    };
    rows.push({
      key: `${masterKey}::${internalRid}`,
      event: {
        ...(options.accountId ? { accountId: options.accountId } : {}),
        ...(calendarId ? { calendarId } : {}),
        eventId: jmapEvent.uid,
        recurrenceId: internalRid,
        isException: true,
        data,
      },
    });
  }

  return rows;
}

function resolvePatchColor(
  patch: JSCalendarPatchObject,
  base: JSCalendarEvent,
): string | undefined {
  if (patch.color !== undefined) return (patch.color as string) || undefined;
  return base.color ?? undefined;
}

function resolvePatchLocation(
  patch: JSCalendarPatchObject,
  base: JSCalendarEvent,
): string | undefined {
  if (patch.locations !== undefined) {
    const locations = patch.locations as Record<string, JSCalendarLocation> | null;
    if (!locations) return undefined;
    const key = firstLocationKey(locations);
    return key ? locations[key]?.name : undefined;
  }
  for (const [key, value] of Object.entries(patch)) {
    const match = /^locations\/[^/]+\/name$/.exec(key);
    if (match) return value as string;
  }
  return primaryLocationName(base);
}

/**
 * Serializes an internal event group back to a JSCalendar object for `CalendarEvent/set`.
 * When `original` (the last known wire object) is given, unknown properties — participants,
 * alerts, extra recurrence rules, unmanaged override patch keys — are preserved verbatim;
 * only properties this mapping owns are rewritten.
 */
export function internalGroupToJmapEvent(
  group: InternalEventGroup,
  options: { original?: JmapCalendarEvent; uid?: string; defaultCalendarId?: string } = {},
): Omit<JmapCalendarEvent, "id"> {
  const { master } = group;
  const { original } = options;
  const allDay = master.data.allDay === true;

  const base: Record<string, unknown> = original
    ? structuredClone(original)
    : { "@type": "Event", uid: options.uid ?? master.eventId ?? crypto.randomUUID() };
  // Server-set / computed properties must not be written back.
  delete base.id;
  delete base.baseEventId;
  delete base.isOrigin;
  delete base.utcStart;
  delete base.utcEnd;
  delete base.updated;

  base.title = master.data.summary;
  base.start = plainDateTimeToLocal(master.data.start);
  base.duration = durationToJs(resolveDuration(master.data));
  base.showWithoutTime = allDay;
  if (master.data.timeZone) base.timeZone = master.data.timeZone;
  else delete base.timeZone;
  if (master.data.color) base.color = master.data.color;
  else delete base.color;

  applyLocation(base, master.data.location);

  if (master.data.recurrenceRule) {
    const mapped = internalRecurrenceRuleToJs(master.data.recurrenceRule);
    const originalRules = original?.recurrenceRules ?? [];
    // Replace the first rule (the one we map); preserve any additional rules verbatim.
    base.recurrenceRules = [mapped, ...originalRules.slice(1)];
  } else {
    delete base.recurrenceRules;
  }

  const overrides = buildRecurrenceOverrides(group, original, allDay);
  if (overrides && Object.keys(overrides).length) base.recurrenceOverrides = overrides;
  else delete base.recurrenceOverrides;

  const calendarIds = resolveCalendarIds(master, original, options.defaultCalendarId);
  if (calendarIds) base.calendarIds = calendarIds;

  return base as Omit<JmapCalendarEvent, "id">;
}

function applyLocation(base: Record<string, unknown>, location: string | undefined): void {
  const locations = base.locations as Record<string, JSCalendarLocation> | null | undefined;
  if (!location) {
    delete base.locations;
    return;
  }
  if (locations && Object.keys(locations).length) {
    const key = firstLocationKey(locations);
    if (key) {
      base.locations = { ...locations, [key]: { ...locations[key], name: location } };
      return;
    }
  }
  base.locations = { "1": { "@type": "Location", name: location } };
}

function resolveCalendarIds(
  master: CalendarEvent,
  original: JmapCalendarEvent | undefined,
  defaultCalendarId: string | undefined,
): Record<string, true> | undefined {
  const calendarId = master.calendarId ?? defaultCalendarId;
  if (original?.calendarIds && calendarId && original.calendarIds[calendarId]) {
    // Still in the same calendar: keep the full server-side set (multi-calendar membership).
    return original.calendarIds;
  }
  if (calendarId) return { [calendarId]: true };
  return original?.calendarIds;
}

function buildRecurrenceOverrides(
  group: InternalEventGroup,
  original: JmapCalendarEvent | undefined,
  allDay: boolean,
): Record<string, JSCalendarPatchObject> | undefined {
  const { master, exceptions } = group;
  const hasRecurrence = Boolean(master.data.recurrenceRule);
  if (!hasRecurrence && !exceptions.size && !master.data.exclusionDates?.size) return undefined;

  const overrides: Record<string, JSCalendarPatchObject> = {};

  for (const internalRid of master.data.exclusionDates ?? []) {
    const rid = internalRecurrenceIdToLocal(internalRid, allDay, master.data.start);
    if (rid) overrides[rid] = { excluded: true };
  }

  for (const [internalRid, exception] of exceptions) {
    const rid = internalRecurrenceIdToLocal(internalRid, allDay, master.data.start);
    if (!rid) continue;
    const originalPatch = original?.recurrenceOverrides?.[rid];
    // Keep unmanaged keys (alerts, participation, …) from the previous patch verbatim.
    const preserved: JSCalendarPatchObject = {};
    for (const [key, value] of Object.entries(originalPatch ?? {})) {
      if (!isManagedPatchKey(key)) preserved[key] = value;
    }
    overrides[rid] = { ...preserved, ...diffExceptionPatch(master, exception, rid) };
  }

  return overrides;
}

function diffExceptionPatch(
  master: CalendarEvent,
  exception: CalendarEvent,
  rid: JSCalendarLocalDateTime,
): JSCalendarPatchObject {
  const patch: JSCalendarPatchObject = {};
  const occurrenceStart = localToPlainDateTime(rid);

  if (exception.data.summary !== master.data.summary) patch.title = exception.data.summary;
  if (Temporal.PlainDateTime.compare(exception.data.start, occurrenceStart) !== 0) {
    patch.start = plainDateTimeToLocal(exception.data.start);
  }
  const masterDuration = durationToJs(resolveDuration(master.data));
  const exceptionDuration = durationToJs(resolveDuration(exception.data));
  if (exceptionDuration !== masterDuration) patch.duration = exceptionDuration;
  if ((exception.data.color ?? undefined) !== (master.data.color ?? undefined)) {
    patch.color = exception.data.color ?? null;
  }
  if ((exception.data.location ?? undefined) !== (master.data.location ?? undefined)) {
    patch.locations = exception.data.location
      ? { "1": { "@type": "Location", name: exception.data.location } }
      : null;
  }
  if ((exception.data.allDay === true) !== (master.data.allDay === true)) {
    patch.showWithoutTime = exception.data.allDay === true;
  }
  return patch;
}

/** Groups internal rows (master + `${masterKey}::rid` exception rows) for serialization. */
export function collectInternalGroup(
  events: ReadonlyMap<string, CalendarEvent>,
  masterKey: string,
): InternalEventGroup | undefined {
  const master = events.get(masterKey);
  if (!master) return undefined;
  const exceptions = new Map<string, CalendarEvent>();
  const prefix = `${masterKey}::`;
  for (const [key, event] of events) {
    if (!key.startsWith(prefix)) continue;
    const rid = event.recurrenceId ?? key.slice(prefix.length);
    exceptions.set(rid, event);
  }
  return { masterKey, master, exceptions };
}
