import { useCallback, useMemo, useRef, useState } from "react";
import type { JmapCalendarEvent } from "@/lib/jmap-client";
import type { CalendarRouteState } from "@/calendar-core/src/calendar-route-search";
import type { CalendarInfo } from "@/calendar-core/src/calendar-types";
import {
  searchCalendarEvents,
  type CalendarSearchDateRange,
  type CalendarSearchResults,
} from "@/calendar-core/src/calendar-search";

export const EMPTY_CALENDAR_SEARCH_RESULTS: CalendarSearchResults = {
  upcoming: [],
  past: [],
  truncatedUpcoming: false,
  truncatedPast: false,
};

export type UseCalendarSearchOptions = {
  events: readonly JmapCalendarEvent[];
  calendars: readonly CalendarInfo[];
  visibleCalendarIds: ReadonlySet<string>;
  /** Visible day/week/month/year — unioned with the bootstrap window. */
  visibleRange: CalendarSearchDateRange;
  /** Latest browse chrome — read at snapshot / restore time, not from a render closure. */
  readBrowse: () => CalendarRouteState;
  restoreBrowse: (next: CalendarRouteState, options?: { replace?: boolean }) => void;
  /** Hydrate from `?q=` on load / back-forward. */
  initialQuery?: string;
  /**
   * App-owned URL write after a committed query change. Not called when
   * `restoreBrowse` already emitted (clear).
   */
  onQueryCommit?: (query: string) => void;
};

export function useCalendarSearch({
  events,
  calendars,
  visibleCalendarIds,
  visibleRange,
  readBrowse,
  restoreBrowse,
  initialQuery = "",
  onQueryCommit,
}: UseCalendarSearchOptions) {
  const [searchQuery, setSearchQueryState] = useState(initialQuery);
  const searchQueryRef = useRef(searchQuery);
  searchQueryRef.current = searchQuery;
  const snapshotRef = useRef<CalendarRouteState | null>(initialQuery.trim() ? readBrowse() : null);
  const onQueryCommitRef = useRef(onQueryCommit);
  onQueryCommitRef.current = onQueryCommit;

  const searchActive = searchQuery.trim().length > 0;

  const setSearchQuery = useCallback(
    (next: string) => {
      const wasActive = searchQueryRef.current.trim().length > 0;
      const nextActive = next.trim().length > 0;
      if (nextActive && !wasActive && snapshotRef.current === null) {
        snapshotRef.current = readBrowse();
      }
      searchQueryRef.current = next;
      setSearchQueryState(next);
      if (!nextActive && wasActive) {
        const snapshot = snapshotRef.current;
        snapshotRef.current = null;
        if (snapshot) restoreBrowse({ ...snapshot, searchQuery: "" }, { replace: true });
        return;
      }
      onQueryCommitRef.current?.(next.trim());
    },
    [readBrowse, restoreBrowse],
  );

  const applyQueryFromRoute = useCallback(
    (next: string) => {
      const wasActive = searchQueryRef.current.trim().length > 0;
      const nextActive = next.trim().length > 0;
      if (nextActive && !wasActive && snapshotRef.current === null) {
        snapshotRef.current = readBrowse();
      }
      if (!nextActive) snapshotRef.current = null;
      searchQueryRef.current = next;
      setSearchQueryState(next);
    },
    [readBrowse],
  );

  const searchResults = useMemo(() => {
    if (!searchActive) return EMPTY_CALENDAR_SEARCH_RESULTS;
    return searchCalendarEvents(events, searchQuery, {
      calendars,
      visibleCalendarIds,
      visibleRange,
    });
  }, [searchActive, events, calendars, visibleCalendarIds, visibleRange, searchQuery]);

  return {
    searchQuery,
    setSearchQuery,
    applyQueryFromRoute,
    searchActive,
    searchResults,
  };
}
