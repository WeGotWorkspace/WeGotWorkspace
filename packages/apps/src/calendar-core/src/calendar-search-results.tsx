import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Circle } from "lucide-react";
import { CollectionListEnd } from "@/collection-layout/src/collection-list-end";
import { useCollectionListEndReached } from "@/collection-layout/src/use-collection-list-end-reached";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import {
  bindCalendarEventSelected,
  type CalendarEventSelectionOrigin,
} from "@/calendar-core/src/calendar-event-preview";
import {
  calendarSearchPageStart,
  formatCalendarSearchScopeLabel,
  searchOccurrencesToEngineMap,
  unifiedSearchOccurrences,
  visibleSearchOccurrences,
  type CalendarSearchDateRange,
  type CalendarSearchResults,
} from "@/calendar-core/src/calendar-search";
import type { CalendarInfo } from "@/calendar-core/src/calendar-types";
import type { TagProps } from "@/tag/src/tag";
import { Tag } from "@/tag/src/tag";
import type { CalendarEventsMap } from "@/lib/calendar-engine";
import type { CalendarListView } from "@/lib/calendar-elements/CalendarListView/CalendarListView";
import "@/lib/calendar-elements/CalendarListView/CalendarListView";

const EMPTY_SEARCH_EVENTS: CalendarEventsMap = new Map();

export type CalendarSearchResultsListProps = {
  results: CalendarSearchResults;
  searchRange: CalendarSearchDateRange;
  visibleCalendars: readonly CalendarInfo[];
  labels: CalendarUILabels;
  locale: string;
  onEventSelected: (key: string, origin?: CalendarEventSelectionOrigin) => void;
};

function calendarTagColors(color: string | undefined): TagProps["colors"] | undefined {
  if (!color) return undefined;
  return {
    backgroundColor: `color-mix(in oklab, ${color} 16%, transparent)`,
    color,
  };
}

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

function SearchAgendaList({
  events,
  locale,
  emptyLabel,
  scrollToKey,
  onEventSelected,
}: {
  events: CalendarEventsMap;
  locale: string;
  emptyLabel?: string;
  scrollToKey?: string;
  onEventSelected: (key: string, origin?: CalendarEventSelectionOrigin) => void;
}) {
  const ref = useRef<CalendarListView | null>(null);
  const scrolledKeyRef = useRef<string | null>(null);

  useEffect(() => {
    scrolledKeyRef.current = null;
  }, [scrollToKey]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.useEventSet = true;
    el.embedded = true;
    el.showYearInHeadings = true;
    el.events = events;
    el.lang = locale;
    if (emptyLabel) el.emptyLabel = emptyLabel;
    const unbind = bindCalendarEventSelected(el, onEventSelected);
    void el.updateComplete.then(() => {
      if (!scrollToKey || scrolledKeyRef.current === scrollToKey) return;
      scrolledKeyRef.current = scrollToKey;
      el.scrollToEvent(scrollToKey);
    });
    return unbind;
  }, [emptyLabel, events, locale, onEventSelected, scrollToKey]);

  return createElement("calendar-list-view", {
    ref,
    class: "calendar-search-results__agenda",
  });
}

export function CalendarSearchResultsList({
  results,
  searchRange,
  visibleCalendars,
  labels,
  locale,
  onEventSelected,
}: CalendarSearchResultsListProps) {
  const listEndRef = useRef<HTMLDivElement | null>(null);
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
  const events = useMemo(() => searchOccurrencesToEngineMap(visible), [visible]);
  const canScrollToUpcoming = Boolean(
    firstUpcomingKey && visible.some((row) => row.key === firstUpcomingKey),
  );
  const empty = results.upcoming.length === 0 && results.past.length === 0;
  const rangeLabel = formatCalendarSearchScopeLabel(labels.searchScope, searchRange, locale);
  const loadMore = useCallback(() => {
    setPageState((prev) => {
      if (prev.sessionKey !== sessionKey) return { sessionKey, extraPages: 0 };
      return { sessionKey, extraPages: prev.extraPages + 1 };
    });
  }, [extraPages, sessionKey]);
  useCollectionListEndReached(listEndRef, !empty && hasMore, loadMore);

  return (
    <div
      className={
        empty ? "calendar-search-results calendar-search-results--empty" : "calendar-search-results"
      }
    >
      <div className="calendar-search-results__scope">
        <Tag label={rangeLabel} icon={<CalendarDays />} />
        {visibleCalendars.map((calendar) => (
          <Tag
            key={calendar.id}
            label={calendar.name}
            icon={<Circle fill="currentColor" strokeWidth={0} />}
            colors={calendarTagColors(calendar.color)}
          />
        ))}
      </div>
      <div className="calendar-search-results__scroller">
        <SearchAgendaList
          events={empty ? EMPTY_SEARCH_EVENTS : events}
          locale={locale}
          emptyLabel={empty ? labels.searchNoMatch : undefined}
          scrollToKey={empty || !canScrollToUpcoming ? undefined : firstUpcomingKey}
          onEventSelected={onEventSelected}
        />
        {!empty && hasMore ? <CollectionListEnd listEndRef={listEndRef} /> : null}
      </div>
    </div>
  );
}
