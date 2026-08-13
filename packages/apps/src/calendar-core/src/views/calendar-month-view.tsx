import { Temporal } from "@js-temporal/polyfill";
import { cn } from "@/lib/utils";
import type {
  CalendarDateRange,
  CalendarOccurrence,
} from "@/calendar-core/src/calendar-event-model";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import { monthGridCells } from "@/calendar-core/src/views/calendar-view-layout";

export type CalendarMonthViewProps = {
  range: CalendarDateRange;
  anchor: string;
  occurrences: CalendarOccurrence[];
  labels: CalendarUILabels;
  onSelectOccurrence?: (occurrence: CalendarOccurrence) => void;
  onSelectDay?: (dateISO: string) => void;
  className?: string;
};

const MAX_CHIPS_PER_CELL = 3;

function weekdayHeadings(range: CalendarDateRange): string[] {
  const headings: string[] = [];
  for (let offset = 0; offset < 7; offset++) {
    headings.push(
      range.start.add({ days: offset }).toLocaleString(undefined, { weekday: "short" }),
    );
  }
  return headings;
}

function chipTime(occurrence: CalendarOccurrence, date: Temporal.PlainDate): string | null {
  if (occurrence.allDay) return null;
  if (Temporal.PlainDate.compare(occurrence.start.toPlainDate(), date) !== 0) return null;
  return occurrence.start.toLocaleString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function CalendarMonthView({
  range,
  anchor,
  occurrences,
  labels,
  onSelectOccurrence,
  onSelectDay,
  className,
}: CalendarMonthViewProps) {
  const weeks = monthGridCells(range, anchor, occurrences);

  return (
    <div className={cn("calendar-month", className)} role="grid" aria-label={labels.viewMonth}>
      <div className="calendar-month__weekdays" role="row">
        {weekdayHeadings(range).map((heading) => (
          <div key={heading} className="calendar-month__weekday" role="columnheader">
            {heading}
          </div>
        ))}
      </div>
      {weeks.map((week) => (
        <div key={week[0].date.toString()} className="calendar-month__week" role="row">
          {week.map((cell) => {
            const overflow = cell.occurrences.length - MAX_CHIPS_PER_CELL;
            return (
              <div
                key={cell.date.toString()}
                role="gridcell"
                className="calendar-month__cell"
                data-outside={!cell.inMonth || undefined}
                data-today={cell.isToday || undefined}
              >
                <button
                  type="button"
                  className="calendar-month__daynumber"
                  onClick={() => onSelectDay?.(cell.date.toString())}
                  aria-label={cell.date.toLocaleString(undefined, {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                  })}
                >
                  {cell.date.day}
                </button>
                <div className="calendar-month__events">
                  {cell.occurrences.slice(0, MAX_CHIPS_PER_CELL).map((occurrence) => {
                    const time = chipTime(occurrence, cell.date);
                    return (
                      <button
                        key={occurrence.key}
                        type="button"
                        className="calendar-event-chip"
                        data-allday={occurrence.allDay || undefined}
                        style={
                          { "--calendar-event-color": occurrence.color } as React.CSSProperties
                        }
                        onClick={() => onSelectOccurrence?.(occurrence)}
                        title={occurrence.title || labels.untitledEvent}
                      >
                        {time ? <span className="calendar-event-chip__time">{time}</span> : null}
                        <span className="calendar-event-chip__title">
                          {occurrence.title.trim() || labels.untitledEvent}
                        </span>
                      </button>
                    );
                  })}
                  {overflow > 0 ? (
                    <button
                      type="button"
                      className="calendar-month__more"
                      onClick={() => onSelectDay?.(cell.date.toString())}
                    >
                      +{overflow}
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
