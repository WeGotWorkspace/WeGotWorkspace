/**
 * Path-based calendar routing utilities.
 *
 * URL structure (matches notes/tasks path segments):
 *   /calendar/:view/:date
 *   /calendar/list/:view/:date
 *
 * `view` is the time-range (day | week | month | year). `date` is an ISO
 * anchor (`YYYY-MM-DD`) in the runtime calendar timezone. List vs grid is a
 * path prefix (`/list/`) so the URL stays bookmarkable without search params.
 */

import { Temporal } from "@js-temporal/polyfill";
import { todayISODate } from "@/calendar-core/src/calendar-event-model";
import type { CalendarPresentation, CalendarViewId } from "@/calendar-core/src/calendar-types";

export const DEFAULT_CALENDAR_VIEW: CalendarViewId = "month";
export const DEFAULT_CALENDAR_PRESENTATION: CalendarPresentation = "grid";

const CALENDAR_VIEWS = new Set<CalendarViewId>(["day", "week", "month", "year"]);
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export type CalendarRouteState = {
  view: CalendarViewId;
  date: string;
  presentation: CalendarPresentation;
};

export type CalendarRouteParams = {
  view?: string;
  date?: string;
};

export type CalendarNavigateTarget = {
  to: "/calendar/$view/$date" | "/calendar/list/$view/$date";
  params: { view: CalendarViewId; date: string };
};

export function isCalendarViewId(value: string): value is CalendarViewId {
  return CALENDAR_VIEWS.has(value as CalendarViewId);
}

/** True only for the calendar app prefix — never `/contacts`, `/notes`, etc. */
export function isCalendarPathname(pathname: string): boolean {
  return pathname === "/calendar" || pathname.startsWith("/calendar/");
}

/** Accept only real ISO calendar dates (`YYYY-MM-DD`), not locale strings. */
export function parseCalendarISODate(value: string): string | null {
  if (!ISO_DATE_RE.test(value)) return null;
  try {
    return Temporal.PlainDate.from(value).toString();
  } catch {
    return null;
  }
}

export function defaultCalendarRouteState(): CalendarRouteState {
  return {
    view: DEFAULT_CALENDAR_VIEW,
    date: todayISODate(),
    presentation: DEFAULT_CALENDAR_PRESENTATION,
  };
}

export function calendarRouteKey(state: CalendarRouteState): string {
  return `${state.presentation}:${state.view}:${state.date}`;
}

export function calendarPathFromState(state: CalendarRouteState): string {
  const { view, date } = state;
  return state.presentation === "list"
    ? `/calendar/list/${view}/${date}`
    : `/calendar/${view}/${date}`;
}

/**
 * Derive view / anchor date / grid-vs-list from the path. Invalid or missing
 * segments fall back to today's defaults — never throw.
 */
export function calendarStateFromLocation(
  pathname: string,
  params: CalendarRouteParams = {},
): CalendarRouteState {
  const defaults = defaultCalendarRouteState();
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "calendar") return defaults;

  const rest = parts.slice(1);
  const presentation: CalendarPresentation = rest[0] === "list" ? "list" : "grid";
  const segs = presentation === "list" ? rest.slice(1) : rest;

  const viewSeg = segs[0] ? decodeURIComponent(segs[0]) : (params.view ?? "");
  const dateSeg = segs[1] ? decodeURIComponent(segs[1]) : (params.date ?? "");

  const view = isCalendarViewId(viewSeg) ? viewSeg : defaults.view;
  const date = parseCalendarISODate(dateSeg) ?? defaults.date;

  return { view, date, presentation };
}

export function calendarNavigateTarget(state: CalendarRouteState): CalendarNavigateTarget {
  const view = isCalendarViewId(state.view) ? state.view : DEFAULT_CALENDAR_VIEW;
  const date = parseCalendarISODate(state.date) ?? todayISODate();
  const params = { view, date };
  if (state.presentation === "list") {
    return { to: "/calendar/list/$view/$date", params };
  }
  return { to: "/calendar/$view/$date", params };
}
