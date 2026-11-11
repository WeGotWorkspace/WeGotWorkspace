import type { ReactNode } from "react";
import { CalendarDays, Repeat } from "lucide-react";
import { ListItem } from "@/list-item/src/list-item";
import { ListStickyHeader } from "@/list-sticky-header/src/list-sticky-header";
import { CollectionState } from "@/collection-state/src/collection-state";
import { CollectionColorDot } from "@/ui/collection-color-dot";
import { useIsTouch } from "@/hooks/use-is-touch";
import type { CalendarInfo } from "@/lib/models/calendar-types";
import {
  formatAgendaDayLabel,
  formatAgendaItemTime,
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
  onSelect: (key: string) => void;
  emptyLabel: string;
  untitledLabel: string;
  /** Search results span years: put the year in the day headings. */
  showYearInHeadings?: boolean;
  /** Under the rows, inside the scroller (e.g. the search results' load-more sentinel). */
  footer?: ReactNode;
};

/**
 * Calendar list mode: the suite list (sticky day headings + `ListItem` rows, as in
 * Contacts and Tasks). Each row: title with its time top right, the location as the
 * preview, the calendar on the meta line.
 */
export function CalendarEventList({
  days,
  calendars,
  locale,
  activeKey,
  onSelect,
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

  return (
    <div className="calendar-event-list">
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
              const calendar = calendars.find((entry) => entry.id === event.calendarId);
              return (
                <ListItem
                  key={item.id}
                  id={`${date.toString()}:${item.id}`}
                  itemId={item.id}
                  title={event.data.summary.trim()}
                  emptyTitle={untitledLabel}
                  date={formatAgendaItemTime(locale, item)}
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
                  isActive={item.id === activeKey}
                  isSelected={false}
                  selectionMode={false}
                  isTouch={isTouch}
                  isDragging={false}
                  onClick={() => onSelect(item.id)}
                />
              );
            })}
          </section>
        );
      })}
      {footer}
    </div>
  );
}
