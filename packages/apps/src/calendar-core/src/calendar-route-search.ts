/**
 * Path-based calendar routing utilities.
 *
 * URL structure (matches notes/tasks path segments):
 *   /calendar/:view/:date
 *   /calendar/list/:view/:date
 *   /calendar/:view/:date?q=standup
 *
 * `view` is the time-range (day | week | month | year). `date` is an ISO
 * anchor (`YYYY-MM-DD`) in the runtime calendar timezone. List vs grid is a
 * path prefix (`/list/`). Free-text search is `?q=` so reload keeps results.
 */

import { Temporal } from "@js-temporal/polyfill";
import { todayISODate } from "@/calendar-core/src/calendar-event-model";
import type { CalendarPresentation, CalendarViewId } from "@/calendar-core/src/calendar-types";

export const DEFAULT_CALENDAR_VIEW: CalendarViewId = "month";
export const DEFAULT_CALENDAR_PRESENTATION: CalendarPresentation = "grid";

const CALENDAR_VIEWS = new Set<CalendarViewId>(["day", "week", "month", "year"]);
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const CALENDAR_SEARCH_QUERY_PARAM = "q";

/** Calendar-only floor. Mail/Notes/Drive/Docs/Contacts stay 1-character. */
export const CALENDAR_SEARCH_MIN_QUERY_LENGTH = 3;

export type CalendarRouteSearch = {
  q?: string;
};

export type CalendarRouteState = {
  view: CalendarViewId;
  date: string;
  presentation: CalendarPresentation;
  /** Trimmed ViewHeader query; empty when browse (no `?q=`). */
  searchQuery: string;
};

export type CalendarRouteParams = {
  view?: string;
  date?: string;
};

export type CalendarNavigateTarget = {
  to: "/calendar/$view/$date" | "/calendar/list/$view/$date";
  params: { view: CalendarViewId; date: string };
  search: CalendarRouteSearch;
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

export type CalendarRouteFallbacks = {
  view?: CalendarViewId;
  presentation?: CalendarPresentation;
};

export function isCalendarSearchQueryActive(value: string | null | undefined): boolean {
  return (value?.trim().length ?? 0) >= CALENDAR_SEARCH_MIN_QUERY_LENGTH;
}

export function normalizeCalendarSearchQuery(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? "";
  return isCalendarSearchQueryActive(trimmed) ? trimmed : "";
}

export function parseCalendarRouteSearch(search: Record<string, unknown>): CalendarRouteSearch {
  const q = typeof search.q === "string" ? normalizeCalendarSearchQuery(search.q) : "";
  return q ? { q } : {};
}

export function validateCalendarRouteSearch(search: Record<string, unknown>): CalendarRouteSearch {
  return parseCalendarRouteSearch(search);
}

export function calendarSearchFromQuery(query: string | null | undefined): CalendarRouteSearch {
  const q = normalizeCalendarSearchQuery(query);
  return q ? { q } : {};
}

/** Accept TanStack `search`, `searchStr`, or a query string. */
export function calendarSearchQueryFromSearch(
  search: CalendarRouteSearch | Record<string, unknown> | string | null | undefined,
): string {
  if (typeof search === "string") {
    const raw = search.startsWith("?") ? search.slice(1) : search;
    return normalizeCalendarSearchQuery(new URLSearchParams(raw).get(CALENDAR_SEARCH_QUERY_PARAM));
  }
  if (!search || typeof search !== "object") return "";
  const q = "q" in search ? search.q : undefined;
  return typeof q === "string" ? normalizeCalendarSearchQuery(q) : "";
}

export function defaultCalendarRouteState(
  fallbacks?: CalendarRouteFallbacks | null,
  searchQuery = "",
): CalendarRouteState {
  return {
    view: fallbacks?.view ?? DEFAULT_CALENDAR_VIEW,
    date: todayISODate(),
    presentation: fallbacks?.presentation ?? DEFAULT_CALENDAR_PRESENTATION,
    searchQuery: normalizeCalendarSearchQuery(searchQuery),
  };
}

export function calendarRouteKey(state: CalendarRouteState): string {
  return `${state.presentation}:${state.view}:${state.date}:${normalizeCalendarSearchQuery(state.searchQuery)}`;
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
  fallbacks?: CalendarRouteFallbacks | null,
  search?: CalendarRouteSearch | Record<string, unknown> | string | null,
): CalendarRouteState {
  const defaults = defaultCalendarRouteState(fallbacks, calendarSearchQueryFromSearch(search));
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "calendar") return defaults;

  const rest = parts.slice(1);
  const hasListPrefix = rest[0] === "list";
  const segs = hasListPrefix ? rest.slice(1) : rest;

  const viewSeg = segs[0] ? decodeURIComponent(segs[0]) : (params.view ?? "");
  const dateSeg = segs[1] ? decodeURIComponent(segs[1]) : (params.date ?? "");

  const view = isCalendarViewId(viewSeg) ? viewSeg : defaults.view;
  const date = parseCalendarISODate(dateSeg) ?? defaults.date;
  const presentation: CalendarPresentation = hasListPrefix
    ? "list"
    : isCalendarViewId(viewSeg)
      ? "grid"
      : defaults.presentation;

  return { view, date, presentation, searchQuery: defaults.searchQuery };
}

export function calendarNavigateTarget(state: CalendarRouteState): CalendarNavigateTarget {
  const view = isCalendarViewId(state.view) ? state.view : DEFAULT_CALENDAR_VIEW;
  const date = parseCalendarISODate(state.date) ?? todayISODate();
  const params = { view, date };
  const search = calendarSearchFromQuery(state.searchQuery);
  if (state.presentation === "list") {
    return { to: "/calendar/list/$view/$date", params, search };
  }
  return { to: "/calendar/$view/$date", params, search };
}
