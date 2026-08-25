import type { CalendarPresentation, CalendarViewId } from "@/calendar-core/src/calendar-types";

export const CALENDAR_VIEW_PREFS_STORAGE_KEY = "wgw.ui.calendar.viewPrefs";

const CALENDAR_VIEWS = new Set<CalendarViewId>(["day", "week", "month", "year"]);
const CALENDAR_PRESENTATIONS = new Set<CalendarPresentation>(["grid", "list"]);

export type CalendarViewPrefs = {
  view?: CalendarViewId;
  presentation?: CalendarPresentation;
  hiddenCalendarIds?: string[];
};

function hasWindowStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function isCalendarPresentation(value: unknown): value is CalendarPresentation {
  return typeof value === "string" && CALENDAR_PRESENTATIONS.has(value as CalendarPresentation);
}

function isStoredView(value: unknown): value is CalendarViewId {
  return typeof value === "string" && CALENDAR_VIEWS.has(value as CalendarViewId);
}

function parseHiddenCalendarIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((id): id is string => typeof id === "string" && id.length > 0);
}

/** Parse stored JSON. Invalid or empty payloads return null — callers use defaults. */
export function parseCalendarViewPrefs(raw: string | null): CalendarViewPrefs | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const prefs: CalendarViewPrefs = {};
    if (isStoredView(record.view)) prefs.view = record.view;
    if (isCalendarPresentation(record.presentation)) prefs.presentation = record.presentation;
    const hiddenCalendarIds = parseHiddenCalendarIds(record.hiddenCalendarIds);
    if (hiddenCalendarIds !== undefined) prefs.hiddenCalendarIds = hiddenCalendarIds;
    return Object.keys(prefs).length > 0 ? prefs : null;
  } catch {
    return null;
  }
}

export function readCalendarViewPrefs(): CalendarViewPrefs | null {
  if (!hasWindowStorage()) return null;
  try {
    return parseCalendarViewPrefs(window.localStorage.getItem(CALENDAR_VIEW_PREFS_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function writeCalendarViewPrefs(prefs: CalendarViewPrefs): void {
  if (!hasWindowStorage()) return;
  try {
    window.localStorage.setItem(CALENDAR_VIEW_PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore storage failures (private mode, quota).
  }
}

export function patchCalendarViewPrefs(partial: CalendarViewPrefs): CalendarViewPrefs | null {
  const current = readCalendarViewPrefs() ?? {};
  const next: CalendarViewPrefs = { ...current };
  if (partial.view !== undefined) next.view = partial.view;
  if (partial.presentation !== undefined) next.presentation = partial.presentation;
  if (partial.hiddenCalendarIds !== undefined) {
    next.hiddenCalendarIds = partial.hiddenCalendarIds;
  }
  writeCalendarViewPrefs(next);
  return Object.keys(next).length > 0 ? next : null;
}

export function persistCalendarRoutePrefs(
  view: CalendarViewId,
  presentation: CalendarPresentation,
): void {
  patchCalendarViewPrefs({ view, presentation });
}

export function persistHiddenCalendarIds(ids: ReadonlySet<string>): void {
  patchCalendarViewPrefs({ hiddenCalendarIds: [...ids] });
}

/** Persist user hides, drop unknown ids, and still hide server-invisible calendars. */
export function resolveHiddenCalendarIds(
  calendars: ReadonlyArray<{ id: string; isVisible?: boolean }>,
  persisted: string[] | undefined,
): string[] {
  const known = new Set(calendars.map((calendar) => calendar.id));
  const fromServer = calendars
    .filter((calendar) => calendar.isVisible === false)
    .map((calendar) => calendar.id);
  if (!persisted) return fromServer;
  return [...new Set([...persisted.filter((id) => known.has(id)), ...fromServer])];
}
