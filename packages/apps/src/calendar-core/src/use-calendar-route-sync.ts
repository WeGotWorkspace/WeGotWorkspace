import { useCallback, useEffect, useMemo, useRef } from "react";
import { useLocation, useParams, useRouter } from "@tanstack/react-router";
import {
  calendarNavigateTarget,
  calendarPathFromState,
  calendarStateFromLocation,
  type CalendarRouteParams,
  type CalendarRouteState,
} from "@/calendar-core/src/calendar-route-search";

/** Sync calendar view / date / list-vs-grid with path-based `/calendar/...` routes. */
export function useCalendarRouteSync() {
  const router = useRouter();
  const location = useLocation();
  const params = useParams({ strict: false }) as CalendarRouteParams;

  const routeState = useMemo(
    () => calendarStateFromLocation(location.pathname, params),
    [location.pathname, params],
  );

  const writeState = useCallback(
    (state: CalendarRouteState, replace: boolean) => {
      const path = calendarPathFromState(state);
      if (router.state.location.pathname === path) return;
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
    const livePath = router.state.location.pathname;
    const canonical = calendarPathFromState(calendarStateFromLocation(livePath));
    if (livePath === canonical) return;
    writeState(calendarStateFromLocation(livePath), true);
  }, [location.pathname, router, writeState]);

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
    handleRouteStateChange,
  };
}
