import { memo, useMemo, type MouseEvent, type ReactNode } from "react";
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
  groupAgendaDays,
  type AgendaDay,
  type AgendaItem,
  type AgendaRange,
} from "@/lib/calendar-elements/utils/agenda-days";
import type { CalendarEventsMap } from "@/lib/calendar-engine";
import { visibleEventsInRange } from "@/lib/calendar-elements/CalendarViewBase/renderedEvents";
import { filterVisibleCalendarEventsKeepingOverlay } from "@/calendar-core/src/calendar-task-due-overlay";
import { isCalendarEventRecurring } from "@/lib/calendar-elements/types/calendarEventSemantics";
import "./calendar-event-list.css";

const MIDNIGHT = { hour: 0, minute: 0, second: 0 } as const;

/** List mode's days: the shown calendars' occurrences in the range, by day. */
export function calendarPeriodDays(
  events: CalendarEventsMap | undefined,
  visibleCalendarIds: Iterable<string>,
  range: AgendaRange,
  timezone: string,
): AgendaDay[] {
  const visible = filterVisibleCalendarEventsKeepingOverlay(events ?? new Map(), [
    ...visibleCalendarIds,
  ]);
  const expanded = visibleEventsInRange(
    visible,
    { start: range.start.toPlainDateTime(MIDNIGHT), end: range.end.toPlainDateTime(MIDNIGHT) },
    timezone,
  );
  return groupAgendaDays(expanded.entries(), { timezone, range });
}

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

const CalendarEventListDayHeading = memo(function CalendarEventListDayHeading({
  id,
  date,
  locale,
  showYear,
}: {
  id: string;
  date: AgendaDay["date"];
  locale: string;
  showYear: boolean;
}) {
  return (
    <ListStickyHeader
      id={id}
      variant="frost"
      emphasis={formatAgendaWeekday(locale, date)}
      rest={formatAgendaDayLabel(locale, date, showYear)}
      label={formatAgendaLongDate(locale, date)}
    />
  );
});

type CalendarEventListRowProps = {
  dateKey: string;
  item: AgendaItem;
  calendar: CalendarInfo | undefined;
  locale: string;
  untitledLabel: string;
  isTouch: boolean;
};

const ROW_PROP_KEYS = [
  "dateKey",
  "item",
  "calendar",
  "locale",
  "untitledLabel",
  "isTouch",
] as const satisfies readonly (keyof CalendarEventListRowProps)[];

/**
 * Same memo rule as `NotesListRow` and `TasksListRow`: compare only the row's own props,
 * as `SwipeableList` clones each child with fresh props on touch (#1714). Active and
 * selected come from the list's selection context, so a click or a keystroke in the
 * detail pane leaves the other rows alone.
 */
function sameRowProps(prev: CalendarEventListRowProps, next: CalendarEventListRowProps): boolean {
  return ROW_PROP_KEYS.every((key) => Object.is(prev[key], next[key]));
}

const RECURRING_ICONS = [<Repeat key="repeat" className="size-3.5" aria-hidden />];
const NO_ICONS: ReactNode[] = [];

/** One occurrence on its day. */
const CalendarEventListRow = memo(function CalendarEventListRow({
  dateKey,
  item,
  calendar,
  locale,
  untitledLabel,
  isTouch,
}: CalendarEventListRowProps) {
  const { event } = item;
  const times = formatAgendaItemTimes(locale, item);
  return (
    <ListItem
      id={`${dateKey}:${item.id}`}
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
      icons={isCalendarEventRecurring(event) ? RECURRING_ICONS : NO_ICONS}
      isActive={false}
      isSelected={false}
      selectionMode={false}
      isTouch={isTouch}
      isDragging={false}
    />
  );
}, sameRowProps);

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
  const calendarsById = useMemo(
    () => new Map(calendars.map((calendar) => [calendar.id, calendar])),
    [calendars],
  );

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
          const dateKey = date.toString();
          const headingId = `calendar-event-list-day-${dateKey}`;
          return (
            <section key={dateKey} aria-labelledby={headingId}>
              <CalendarEventListDayHeading
                id={headingId}
                date={date}
                locale={locale}
                showYear={showYearInHeadings}
              />
              {items.map((item) => (
                <CalendarEventListRow
                  key={item.id}
                  dateKey={dateKey}
                  item={item}
                  calendar={calendarsById.get(item.event.calendarId ?? "")}
                  locale={locale}
                  untitledLabel={untitledLabel}
                  isTouch={isTouch}
                />
              ))}
            </section>
          );
        })}
      </WorkspaceSwipeList>
      {footer}
    </div>
  );
}
