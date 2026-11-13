import type { CalendarEvent, CalendarEventsMap } from "@/lib/calendar-engine";

/**
 * Render-only rows on the grid: Tasks due markers and teammates' busy blocks.
 * They never go through EventsAPI or Calendar JMAP, so drag, resize, delete
 * and edit stop here.
 */
export function isRenderOnlyOverlayKey(key: string | undefined | null): boolean {
  return isTaskDueOverlayKey(key) || parseAvailabilityOverlayKey(key) !== null;
}

export function isRenderOnlyOverlayEvent(
  event: Pick<CalendarEvent, "overlayKind" | "eventId" | "calendarId"> | undefined | null,
): boolean {
  return isTaskDueOverlayEvent(event) || isAvailabilityOverlayEvent(event);
}

// Tasks due markers: one render-only row per open task with a due date.

export const TASK_DUE_OVERLAY_KEY_PREFIX = "task:";

export const TASK_DUE_OVERLAY_KIND = "task" as const;

export function taskDueOverlayKey(taskId: string): string {
  return `${TASK_DUE_OVERLAY_KEY_PREFIX}${taskId}`;
}

export function parseTaskDueOverlayKey(key: string | undefined | null): string | null {
  if (!key?.startsWith(TASK_DUE_OVERLAY_KEY_PREFIX)) return null;
  const taskId = key.slice(TASK_DUE_OVERLAY_KEY_PREFIX.length);
  return taskId.length > 0 ? taskId : null;
}

export function isTaskDueOverlayKey(key: string | undefined | null): boolean {
  return parseTaskDueOverlayKey(key) !== null;
}

export function isTaskDueOverlayEvent(
  event: Pick<CalendarEvent, "overlayKind" | "eventId"> | undefined | null,
): boolean {
  if (!event) return false;
  return event.overlayKind === TASK_DUE_OVERLAY_KIND || isTaskDueOverlayKey(event.eventId);
}

// Teammates' busy blocks (Team availability).

/** Prefix of a teammate's virtual, read-only calendar and of its grid keys. */
export const AVAILABILITY_CALENDAR_PREFIX = "availability:";

export const AVAILABILITY_OVERLAY_KIND = "availability" as const;

/** `availability:{username}`. Never stored as a calendar, never a default or invite target. */
export function availabilityCalendarId(username: string): string {
  return `${AVAILABILITY_CALENDAR_PREFIX}${username}`;
}

export function isAvailabilityCalendarId(id: string | undefined | null): boolean {
  return Boolean(id?.startsWith(AVAILABILITY_CALENDAR_PREFIX));
}

/** Grid key of one busy period: `availability:{username}#{index}`. */
export function availabilityOverlayKey(username: string, index: number): string {
  return `${availabilityCalendarId(username)}#${index}`;
}

export function parseAvailabilityOverlayKey(
  key: string | undefined | null,
): { username: string; index: number } | null {
  if (!key?.startsWith(AVAILABILITY_CALENDAR_PREFIX)) return null;
  const rest = key.slice(AVAILABILITY_CALENDAR_PREFIX.length);
  const hash = rest.lastIndexOf("#");
  if (hash <= 0) return null;
  const index = Number(rest.slice(hash + 1));
  if (!Number.isInteger(index) || index < 0) return null;
  return { username: rest.slice(0, hash), index };
}

export function isAvailabilityOverlayEvent(
  event: Pick<CalendarEvent, "overlayKind" | "calendarId"> | undefined | null,
): boolean {
  if (!event) return false;
  return (
    event.overlayKind === AVAILABILITY_OVERLAY_KIND || isAvailabilityCalendarId(event.calendarId)
  );
}

/** Any render-only row (task dues, teammates' busy blocks) — they all carry `overlayKind`. */
function isRenderOnlyRow(key: string, event: CalendarEvent): boolean {
  return isTaskDueOverlayEvent(event) || isTaskDueOverlayKey(key) || event.overlayKind != null;
}

export function extractRenderOnlyOverlayEvents(events: CalendarEventsMap): CalendarEventsMap {
  const overlay: CalendarEventsMap = new Map();
  for (const [key, event] of events) {
    if (isRenderOnlyRow(key, event)) {
      overlay.set(key, event);
    }
  }
  return overlay;
}

export function omitRenderOnlyOverlayEvents(events: CalendarEventsMap): CalendarEventsMap {
  let changed = false;
  const next: CalendarEventsMap = new Map();
  for (const [key, event] of events) {
    if (isRenderOnlyRow(key, event)) {
      changed = true;
      continue;
    }
    next.set(key, event);
  }
  return changed ? next : events;
}

export function mergeRenderOnlyOverlayEvents(
  events: CalendarEventsMap,
  overlay: CalendarEventsMap,
): CalendarEventsMap {
  if (overlay.size === 0) return events;
  const next: CalendarEventsMap = new Map(omitRenderOnlyOverlayEvents(events));
  for (const [key, event] of overlay) next.set(key, event);
  return next;
}

export function preserveRenderOnlyOverlayEvents(
  previous: CalendarEventsMap | undefined,
  next: CalendarEventsMap,
): CalendarEventsMap {
  return mergeRenderOnlyOverlayEvents(
    omitRenderOnlyOverlayEvents(next),
    extractRenderOnlyOverlayEvents(previous ?? new Map()),
  );
}

/**
 * Calendar visibility filter that still paints overlay rows (no calendarId).
 * Empty `visibleCalendarIds` hides every VEVENT but keeps task dues already
 * sitting in `events`. Live Tasks dues are merged separately via
 * `taskDueMarkers` on `wgw-calendar-surface` after this filter.
 */
export function filterVisibleCalendarEventsKeepingOverlay(
  events: CalendarEventsMap,
  visibleCalendarIds?: readonly string[],
): CalendarEventsMap {
  if (visibleCalendarIds === undefined) return events;
  const allowed = new Set(visibleCalendarIds);
  const filtered: CalendarEventsMap = new Map();
  for (const [key, event] of events) {
    if (isRenderOnlyRow(key, event)) {
      filtered.set(key, event);
      continue;
    }
    if (allowed.size === 0) continue;
    if (!event.calendarId || allowed.has(event.calendarId)) {
      filtered.set(key, event);
    }
  }
  return filtered;
}
