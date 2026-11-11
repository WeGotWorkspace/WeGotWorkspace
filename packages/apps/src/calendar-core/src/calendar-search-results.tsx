import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CollectionListEnd } from "@/collection-layout/src/collection-list-end";
import { useCollectionListEndReached } from "@/collection-layout/src/use-collection-list-end-reached";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import {
  CalendarEventList,
  type CalendarEventListSelection,
} from "@/calendar-core/src/calendar-event-list";
import {
  calendarSearchPageStart,
  searchOccurrencesToEngineMap,
  unifiedSearchOccurrences,
  visibleSearchOccurrences,
  type CalendarSearchResults,
} from "@/calendar-core/src/calendar-search";
import type { CalendarInfo } from "@/lib/models/calendar-types";
import { groupAgendaDays } from "@/lib/calendar-elements/utils/agenda-days";

export type CalendarSearchResultsListProps = {
  results: CalendarSearchResults;
  labels: CalendarUILabels;
  locale: string;
  calendars: readonly CalendarInfo[];
  timezone?: string;
  /** The occurrence open in the detail pane. */
  activeKey?: string;
  selection: CalendarEventListSelection;
};

function searchResultsSessionKey(results: CalendarSearchResults): string {
  return [
    results.past.length,
    results.upcoming.length,
    results.past[0]?.key ?? "",
    results.upcoming[0]?.key ?? "",
    results.past.at(-1)?.key ?? "",
    results.upcoming.at(-1)?.key ?? "",
  ].join(":");
}

export function CalendarSearchResultsList({
  results,
  labels,
  locale,
  calendars,
  timezone,
  activeKey,
  selection,
}: CalendarSearchResultsListProps) {
  const listEndRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const all = useMemo(() => unifiedSearchOccurrences(results), [results]);
  const sessionKey = searchResultsSessionKey(results);
  const firstUpcomingKey = results.upcoming[0]?.key;
  const [pageState, setPageState] = useState({ sessionKey, extraPages: 0 });
  if (pageState.sessionKey !== sessionKey) {
    setPageState({ sessionKey, extraPages: 0 });
  }
  const extraPages = pageState.sessionKey === sessionKey ? pageState.extraPages : 0;
  const visible = useMemo(
    () => visibleSearchOccurrences(all, extraPages, firstUpcomingKey),
    [all, extraPages, firstUpcomingKey],
  );
  const pageStart = calendarSearchPageStart(all, firstUpcomingKey);
  const hasMore = pageStart + visible.length < all.length;
  const days = useMemo(
    () => groupAgendaDays(searchOccurrencesToEngineMap(visible).entries(), { timezone }),
    [timezone, visible],
  );
  const canScrollToUpcoming = Boolean(
    firstUpcomingKey && visible.some((row) => row.key === firstUpcomingKey),
  );
  const empty = results.upcoming.length === 0 && results.past.length === 0;
  const loadMore = useCallback(() => {
    setPageState((prev) => {
      if (prev.sessionKey !== sessionKey) return { sessionKey, extraPages: 0 };
      return { sessionKey, extraPages: prev.extraPages + 1 };
    });
  }, [extraPages, sessionKey]);
  useCollectionListEndReached(listEndRef, !empty && hasMore, loadMore);

  // Open on the first upcoming match, once per result set.
  const scrolledKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!canScrollToUpcoming || !firstUpcomingKey) return;
    if (scrolledKeyRef.current === `${sessionKey}:${firstUpcomingKey}`) return;
    scrolledKeyRef.current = `${sessionKey}:${firstUpcomingKey}`;
    const row = rootRef.current?.querySelector(
      `[data-list-item-id="${CSS.escape(firstUpcomingKey)}"]`,
    );
    row?.closest("section")?.scrollIntoView({ block: "start" });
  }, [canScrollToUpcoming, firstUpcomingKey, sessionKey]);

  return (
    <div
      ref={rootRef}
      className={
        empty ? "calendar-search-results calendar-search-results--empty" : "calendar-search-results"
      }
    >
      <CalendarEventList
        days={empty ? [] : days}
        calendars={calendars}
        locale={locale}
        activeKey={activeKey}
        {...selection}
        emptyLabel={labels.searchNoMatch}
        untitledLabel={labels.untitledEvent}
        showYearInHeadings
        footer={!empty && hasMore ? <CollectionListEnd listEndRef={listEndRef} /> : null}
      />
    </div>
  );
}
