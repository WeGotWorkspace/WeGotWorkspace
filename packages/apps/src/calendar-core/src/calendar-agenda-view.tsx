import { Temporal } from "@js-temporal/polyfill";
import { cn } from "@/lib/utils";
import type { CalendarOccurrence } from "@/calendar-core/src/calendar-event-model";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";

export type CalendarAgendaViewProps = {
  occurrences: CalendarOccurrence[];
  labels: CalendarUILabels;
  onSelectOccurrence?: (occurrence: CalendarOccurrence) => void;
  className?: string;
};

function dayHeading(date: Temporal.PlainDate): string {
  return date.toLocaleString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function timeLabel(occurrence: CalendarOccurrence, labels: CalendarUILabels): string {
  if (occurrence.allDay) return labels.allDay;
  const format: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };
  return `${occurrence.start.toLocaleString(undefined, format)} – ${occurrence.end.toLocaleString(undefined, format)}`;
}

export function CalendarAgendaView({
  occurrences,
  labels,
  onSelectOccurrence,
  className,
}: CalendarAgendaViewProps) {
  if (occurrences.length === 0) {
    return <p className={cn("calendar-agenda-empty", className)}>{labels.noEventsInRange}</p>;
  }

  const byDay = new Map<string, CalendarOccurrence[]>();
  for (const occurrence of occurrences) {
    const day = occurrence.start.toPlainDate().toString();
    const bucket = byDay.get(day);
    if (bucket) {
      bucket.push(occurrence);
    } else {
      byDay.set(day, [occurrence]);
    }
  }

  return (
    <div className={cn("calendar-agenda", className)}>
      {[...byDay.entries()].map(([day, dayOccurrences]) => (
        <section key={day} className="calendar-agenda-day" aria-label={day}>
          <h3 className="calendar-agenda-day__heading">
            {dayHeading(Temporal.PlainDate.from(day))}
          </h3>
          <ul className="calendar-agenda-day__list">
            {dayOccurrences.map((occurrence) => (
              <li key={occurrence.key}>
                <button
                  type="button"
                  className="calendar-agenda-item"
                  onClick={() => onSelectOccurrence?.(occurrence)}
                >
                  <span
                    className="calendar-agenda-item__dot"
                    style={{ backgroundColor: occurrence.color }}
                    aria-hidden
                  />
                  <span className="calendar-agenda-item__time">
                    {timeLabel(occurrence, labels)}
                  </span>
                  <span className="calendar-agenda-item__title">
                    {occurrence.title.trim() || labels.untitledEvent}
                  </span>
                  {occurrence.location ? (
                    <span className="calendar-agenda-item__location">{occurrence.location}</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
