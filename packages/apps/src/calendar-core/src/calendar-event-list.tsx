import type { MouseEvent, ReactNode } from "react";
import { CalendarDays, Repeat } from "lucide-react";
import { ListItem } from "@/list-item/src/list-item";
import { ListStickyHeader } from "@/list-sticky-header/src/list-sticky-header";
import { CollectionState } from "@/collection-state/src/collection-state";
import { CollectionColorDot } from "@/ui/collection-color-dot";
import { WorkspaceSwipeList } from "@/workspace-swipe-list/src/workspace-swipe-list";
import { useIsTouch } from "@/hooks/use-is-touch";
import type { CalendarInfo } from "@/lib/models/calendar-types";
import {
  formatAgendaDayLabel,
  formatAgendaItemTimes,
  formatAgendaLongDate,
  formatAgendaWeekday,
  type AgendaDay,
} from "@/lib/calendar-elements/utils/agenda-days";
import { isCalendarEventRecurring } from "@/lib/calendar-elements/types/calendarEventSemantics";
import "./calendar-event-list.css";

export type CalendarEventListProps = {
  days: readonly AgendaDay[];
  calendars: readonly CalendarInfo[];
  locale: string;
  /** The occurrence open in the detail pane. */
  activeKey?: string;
  /** Multi-select (as in Tasks, Notes, Contacts): the picked occurrences. */
  selectedIds?: readonly string[];
  selectionMode?: boolean;
  /** A click (plain, Cmd/Ctrl or Shift) on a row. */
  onItemClick: (key: string, event: MouseEvent) => void;
  /** A long press on touch: starts multi-select with that row. */
  onItemLongPress?: (key: string) => void;
  emptyLabel: string;
  untitledLabel: string;
  /** Search results span years: put the year in the day headings. */
  showYearInHeadings?: boolean;
  /** Under the rows, inside the scroller (e.g. the search results' load-more sentinel). */
  footer?: ReactNode;
};

/** The list's multi-select wiring, handed on as one (period list and search results). */
export type CalendarEventListSelection = Pick<
  CalendarEventListProps,
  "selectedIds" | "selectionMode" | "onItemClick" | "onItemLongPress"
>;

/**
 * Calendar list mode: the suite list (sticky day headings + `ListItem` rows, as in
 * Contacts and Tasks). Each row: title with its start top right and its end under it, the location as the
 * preview, the calendar on the meta line.
 */
export function CalendarEventList({
  days,
  calendars,
  locale,
  activeKey = "",
  selectedIds = [],
  selectionMode = false,
  onItemClick,
  onItemLongPress,
  emptyLabel,
  untitledLabel,
  showYearInHeadings = false,
  footer,
}: CalendarEventListProps) {
  const isTouch = useIsTouch();

  if (days.length === 0) {
    return (
      <div className="calendar-event-list calendar-event-list--empty collection-state-host">
        <CollectionState icon={<CalendarDays className="size-12" />}>{emptyLabel}</CollectionState>
      </div>
    );
  }

  const multiSelect = selectionMode || selectedIds.length > 1;
  return (
    <div className="calendar-event-list">
      <WorkspaceSwipeList
        isTouch={isTouch}
        // As in Tasks: only the single open event paints as active.
        activeId={multiSelect ? "" : activeKey}
        selectedIds={selectedIds}
        selectionMode={multiSelect}
        onItemClick={onItemClick}
        onItemLongPress={onItemLongPress}
      >
      {days.map(({ date, items }) => {
        const headingId = `calendar-event-list-day-${date.toString()}`;
        return (
          <section key={date.toString()} aria-labelledby={headingId}>
            <ListStickyHeader
              id={headingId}
              variant="frost"
              emphasis={formatAgendaWeekday(locale, date)}
              rest={formatAgendaDayLabel(locale, date, showYearInHeadings)}
              label={formatAgendaLongDate(locale, date)}
            />
            {items.map((item) => {
              const { event } = item;
              const times = formatAgendaItemTimes(locale, item);
              const calendar = calendars.find((entry) => entry.id === event.calendarId);
              return (
                <ListItem
                  key={item.id}
                  id={`${date.toString()}:${item.id}`}
                  itemId={item.id}
                  title={event.data.summary.trim()}
                  emptyTitle={untitledLabel}
                  date={times.start}
                  dateBelow={times.end}
                  metaPosition="below"
                  text={event.data.location?.trim() || null}
                  subtitle={
                    calendar ? (
                      <span className="calendar-event-list__calendar">
                        <CollectionColorDot color={calendar.color} />
                        <span className="calendar-event-list__calendar-name">{calendar.name}</span>
                      </span>
                    ) : null
                  }
                  icons={
                    isCalendarEventRecurring(event)
                      ? [<Repeat key="repeat" className="size-3.5" aria-hidden />]
                      : []
                  }
                  isActive={false}
                  isSelected={false}
                  selectionMode={false}
                  isTouch={isTouch}
                  isDragging={false}
                />
              );
            })}
          </section>
        );
      })}
      </WorkspaceSwipeList>
      {footer}
    </div>
  );
}
