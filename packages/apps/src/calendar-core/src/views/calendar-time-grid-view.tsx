import { cn } from "@/lib/utils";
import type {
  CalendarDateRange,
  CalendarOccurrence,
} from "@/calendar-core/src/calendar-event-model";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import {
  staggerBlockMetrics,
  timeGridColumns,
} from "@/calendar-core/src/views/calendar-view-layout";

export type CalendarTimeGridViewProps = {
  range: CalendarDateRange;
  occurrences: CalendarOccurrence[];
  labels: CalendarUILabels;
  onSelectOccurrence?: (occurrence: CalendarOccurrence) => void;
  onSelectDay?: (dateISO: string) => void;
  /** Click-to-create on an empty grid slot (hour granularity). */
  onCreateSlot?: (dateISO: string, startTime: string) => void;
  className?: string;
};

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

function hourLabel(hour: number): string {
  return new Date(Date.UTC(2033, 0, 1, hour)).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

function blockTimeLabel(occurrence: CalendarOccurrence): string {
  const format: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };
  return `${occurrence.start.toLocaleString(undefined, format)} – ${occurrence.end.toLocaleString(undefined, format)}`;
}

/** Week (7 columns) and day (1 column) timed grid with an all-day lane. */
export function CalendarTimeGridView({
  range,
  occurrences,
  labels,
  onSelectOccurrence,
  onSelectDay,
  onCreateSlot,
  className,
}: CalendarTimeGridViewProps) {
  const columns = timeGridColumns(range, occurrences);
  const showDayHeaders = columns.length > 1;

  return (
    <div
      className={cn("calendar-timegrid", className)}
      data-days={columns.length}
      style={{ "--calendar-timegrid-days": columns.length } as React.CSSProperties}
    >
      {showDayHeaders ? (
        <div className="calendar-timegrid__headers">
          <div className="calendar-timegrid__gutter-spacer" aria-hidden />
          {columns.map((column) => (
            <button
              key={column.date.toString()}
              type="button"
              className="calendar-timegrid__dayheader"
              data-today={column.isToday || undefined}
              onClick={() => onSelectDay?.(column.date.toString())}
            >
              <span className="calendar-timegrid__dayheader-weekday">
                {column.date.toLocaleString(undefined, { weekday: "short" })}
              </span>
              <span className="calendar-timegrid__dayheader-number">{column.date.day}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="calendar-timegrid__allday" aria-label={labels.allDay}>
        <div className="calendar-timegrid__gutter-spacer">{labels.allDay}</div>
        {columns.map((column) => (
          <div key={column.date.toString()} className="calendar-timegrid__allday-cell">
            {column.allDay.map((occurrence) => (
              <button
                key={occurrence.key}
                type="button"
                className="calendar-event-chip"
                data-allday
                style={{ "--calendar-event-color": occurrence.color } as React.CSSProperties}
                onClick={() => onSelectOccurrence?.(occurrence)}
                title={occurrence.title || labels.untitledEvent}
              >
                <span className="calendar-event-chip__title">
                  {occurrence.title.trim() || labels.untitledEvent}
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="calendar-timegrid__body">
        <div className="calendar-timegrid__gutter" aria-hidden>
          {HOURS.map((hour) => (
            <div key={hour} className="calendar-timegrid__hourlabel">
              {hour > 0 ? hourLabel(hour) : ""}
            </div>
          ))}
        </div>
        {columns.map((column) => (
          <div
            key={column.date.toString()}
            className="calendar-timegrid__column"
            data-today={column.isToday || undefined}
          >
            {HOURS.map((hour) => (
              <button
                key={hour}
                type="button"
                tabIndex={-1}
                className="calendar-timegrid__hourline"
                aria-label={`${column.date.toString()} ${hourLabel(hour)}`}
                onClick={() =>
                  onCreateSlot?.(column.date.toString(), `${String(hour).padStart(2, "0")}:00`)
                }
              />
            ))}
            {column.timed.map((block) => {
              const metrics = staggerBlockMetrics(block.layout);
              return (
                <button
                  key={block.occurrence.key}
                  type="button"
                  className="calendar-timegrid__event"
                  style={
                    {
                      top: `${block.top}%`,
                      height: `${block.height}%`,
                      left: `${metrics.leftPercent}%`,
                      width: `${metrics.widthPercent}%`,
                      zIndex: metrics.zIndex,
                      "--calendar-event-color": block.occurrence.color,
                    } as React.CSSProperties
                  }
                  onClick={() => onSelectOccurrence?.(block.occurrence)}
                  title={`${block.occurrence.title || labels.untitledEvent} (${blockTimeLabel(block.occurrence)})`}
                >
                  <span className="calendar-timegrid__event-title">
                    {block.occurrence.title.trim() || labels.untitledEvent}
                  </span>
                  <span className="calendar-timegrid__event-time">
                    {blockTimeLabel(block.occurrence)}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
