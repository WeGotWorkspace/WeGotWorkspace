import { createElement, useEffect, useMemo, useRef } from "react";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import {
  bindCalendarEventSelected,
  type CalendarEventSelectionOrigin,
} from "@/calendar-core/src/calendar-event-preview";
import {
  searchOccurrencesToEngineMap,
  unifiedSearchOccurrences,
  type CalendarSearchResults,
} from "@/calendar-core/src/calendar-search";
import type { CalendarEventsMap } from "@/lib/calendar-engine";
import type { CalendarListView } from "@/lib/calendar-elements/CalendarListView/CalendarListView";
import "@/lib/calendar-elements/CalendarListView/CalendarListView";

const EMPTY_SEARCH_EVENTS: CalendarEventsMap = new Map();

export type CalendarSearchResultsListProps = {
  results: CalendarSearchResults;
  labels: CalendarUILabels;
  locale: string;
  onEventSelected: (key: string, origin?: CalendarEventSelectionOrigin) => void;
};

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

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.useEventSet = true;
    el.events = events;
    el.lang = locale;
    if (emptyLabel) el.emptyLabel = emptyLabel;
    const unbind = bindCalendarEventSelected(el, onEventSelected);
    void el.updateComplete.then(() => {
      if (scrollToKey) el.scrollToEvent(scrollToKey);
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
  labels,
  locale,
  onEventSelected,
}: CalendarSearchResultsListProps) {
  const events = useMemo(
    () => searchOccurrencesToEngineMap(unifiedSearchOccurrences(results)),
    [results],
  );
  const firstUpcomingKey = results.upcoming[0]?.key;
  const empty = results.upcoming.length === 0 && results.past.length === 0;

  if (empty) {
    return (
      <div className="calendar-search-results calendar-search-results--empty">
        <SearchAgendaList
          events={EMPTY_SEARCH_EVENTS}
          locale={locale}
          emptyLabel={labels.searchNoMatch}
          onEventSelected={onEventSelected}
        />
      </div>
    );
  }

  return (
    <div className="calendar-search-results">
      <SearchAgendaList
        events={events}
        locale={locale}
        scrollToKey={firstUpcomingKey}
        onEventSelected={onEventSelected}
      />
    </div>
  );
}
