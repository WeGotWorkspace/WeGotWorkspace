import { useCallback, useEffect, useMemo, useRef } from "react";
import { useLocation, useParams, useRouter } from "@tanstack/react-router";
import {
  persistCalendarRoutePrefs,
  readCalendarViewPrefs,
} from "@/calendar-core/src/calendar-view-prefs";
import {
  calendarNavigateTarget,
  calendarPathFromState,
  calendarSearchQueryFromSearch,
  calendarStateFromLocation,
  isCalendarPathname,
  normalizeCalendarSearchQuery,
  type CalendarRouteParams,
  type CalendarRouteState,
} from "@/calendar-core/src/calendar-route-search";

function liveCalendarLocation(router: {
  state: { location: { pathname: string; search: unknown } };
}) {
  return {
    pathname: router.state.location.pathname,
    searchQuery: calendarSearchQueryFromSearch(
      router.state.location.search as Record<string, unknown>,
    ),
  };
}

function calendarLocationMatches(
  live: { pathname: string; searchQuery: string },
  state: CalendarRouteState,
): boolean {
  return (
    live.pathname === calendarPathFromState(state) &&
    live.searchQuery === normalizeCalendarSearchQuery(state.searchQuery)
  );
}

/** Sync calendar view / date / list-vs-grid / `?q=` with path-based `/calendar/...` routes. */
export function useCalendarRouteSync() {
  const router = useRouter();
  const location = useLocation();
  const params = useParams({ strict: false }) as CalendarRouteParams;

  const routeState = useMemo(
    () =>
      calendarStateFromLocation(
        location.pathname,
        params,
        readCalendarViewPrefs(),
        location.search as Record<string, unknown>,
      ),
    [location.pathname, location.search, params],
  );

  const writeState = useCallback(
    (state: CalendarRouteState, replace: boolean) => {
      const live = liveCalendarLocation(router);
      // Leaving calendar (app switcher, back) must not rewrite the new app
      // onto `/calendar/...`. Parse treats foreign paths as "defaults".
      if (!isCalendarPathname(live.pathname)) return;
      if (calendarLocationMatches(live, state)) return;
      // Must go through navigate() so TanStack builds a new location (same
      // `/calendar/$view/$date` route, new params). Raw history.push updates
      // the in-memory history object but createBrowserHistory coalesces a
      // follow-up replace of the still-matched month URL and the address bar
      // never moves.
      void router.navigate({ ...calendarNavigateTarget(state), replace }).then(() => {
        router.history.flush?.();
      });
    },
    [router],
  );

  useEffect(() => {
    const live = liveCalendarLocation(router);
    if (!isCalendarPathname(live.pathname)) return;
    persistCalendarRoutePrefs(routeState.view, routeState.presentation);
    const prefs = readCalendarViewPrefs();
    const next = calendarStateFromLocation(
      live.pathname,
      {},
      prefs,
      router.state.location.search as Record<string, unknown>,
    );
    if (calendarLocationMatches(live, next)) return;
    writeState(next, true);
  }, [
    location.pathname,
    location.search,
    routeState.presentation,
    routeState.view,
    router,
    writeState,
  ]);

  const handleRef = useRef(writeState);
  handleRef.current = writeState;

  const handleRouteStateChange = useCallback(
    (state: CalendarRouteState, options?: { replace?: boolean }) => {
      handleRef.current(state, options?.replace === true);
    },
    [],
  );

  return {
    initialView: routeState.view,
    initialPresentation: routeState.presentation,
    initialAnchor: routeState.date,
    initialSearchQuery: routeState.searchQuery,
    handleRouteStateChange,
  };
}
