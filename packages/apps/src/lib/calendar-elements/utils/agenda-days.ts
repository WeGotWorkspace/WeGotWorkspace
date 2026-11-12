import { Temporal } from "@js-temporal/polyfill";
import type { CalendarEvent } from "@/lib/calendar-engine";
import { resolvedDataEnd } from "../domain/events-api/eventMapBridge.js";
import { eventOccurrenceInDisplayZone } from "./event-display-time.js";
import { formatShortTime } from "./TimeFormatting.js";

/** One occurrence on one day of an agenda (a multi-day event is listed on each day). */
export type AgendaItem = {
  id: string;
  event: CalendarEvent;
  start: Temporal.PlainDateTime;
  end: Temporal.PlainDateTime;
  displayDate: Temporal.PlainDate;
  continuesFromPreviousDay: boolean;
  continuesToNextDay: boolean;
};

export type AgendaDay = {
  date: Temporal.PlainDate;
  items: AgendaItem[];
};

export type AgendaRange = {
  start: Temporal.PlainDate;
  /** Exclusive. */
  end: Temporal.PlainDate;
};

const MIDNIGHT = { hour: 0, minute: 0, second: 0 } as const;

/**
 * Group expanded occurrences by day, in the display time zone. With a `range`, only
 * the days inside it are listed (an event that started earlier shows from its start).
 */
export function groupAgendaDays(
  events: Iterable<[string, CalendarEvent]>,
  options: { timezone?: string; range?: AgendaRange; sortDirection?: "asc" | "desc" },
): AgendaDay[] {
  const { range, sortDirection = "asc" } = options;
  const timezone = options.timezone || Temporal.Now.timeZoneId();
  const grouped = new Map<string, AgendaItem[]>();
  for (const [id, event] of events) {
    const start = eventOccurrenceInDisplayZone(event.data.start, event.data, timezone);
    const end = eventOccurrenceInDisplayZone(resolvedDataEnd(event.data), event.data, timezone);
    if (Temporal.PlainDateTime.compare(end, start) <= 0) continue;
    if (
      range &&
      (Temporal.PlainDateTime.compare(start, range.end.toPlainDateTime(MIDNIGHT)) >= 0 ||
        Temporal.PlainDateTime.compare(end, range.start.toPlainDateTime(MIDNIGHT)) <= 0)
    ) {
      continue;
    }

    const eventStartDate = start.toPlainDate();
    const eventEndDateInclusive = end.subtract({ nanoseconds: 1 }).toPlainDate();
    const lastRangeDate = range?.end.subtract({ days: 1 });
    const firstDisplayDate =
      range && Temporal.PlainDate.compare(eventStartDate, range.start) < 0
        ? range.start
        : eventStartDate;
    const lastDisplayDate =
      lastRangeDate && Temporal.PlainDate.compare(eventEndDateInclusive, lastRangeDate) > 0
        ? lastRangeDate
        : eventEndDateInclusive;

    let displayDate = firstDisplayDate;
    while (Temporal.PlainDate.compare(displayDate, lastDisplayDate) <= 0) {
      const key = displayDate.toString();
      const dayItems = grouped.get(key) ?? [];
      dayItems.push({
        id,
        event,
        start,
        end,
        displayDate,
        continuesFromPreviousDay: Temporal.PlainDate.compare(eventStartDate, displayDate) < 0,
        continuesToNextDay: Temporal.PlainDate.compare(eventEndDateInclusive, displayDate) > 0,
      });
      grouped.set(key, dayItems);
      displayDate = displayDate.add({ days: 1 });
    }
  }

  const days = Array.from(grouped.entries())
    .sort(([a], [b]) =>
      Temporal.PlainDate.compare(Temporal.PlainDate.from(a), Temporal.PlainDate.from(b)),
    )
    .map(([date, items]) => ({
      date: Temporal.PlainDate.from(date),
      items: items.sort(compareAgendaItems),
    }));
  return sortDirection === "desc" ? days.reverse() : days;
}

function compareAgendaItems(a: AgendaItem, b: AgendaItem): number {
  const startDiff = Temporal.PlainDateTime.compare(a.start, b.start);
  if (startDiff !== 0) return startDiff;
  const endDiff = Temporal.PlainDateTime.compare(a.end, b.end);
  if (endDiff !== 0) return endDiff;
  return a.event.data.summary.localeCompare(b.event.data.summary);
}

function utcDate(value: Temporal.PlainDate | Temporal.PlainDateTime): Date {
  if (value instanceof Temporal.PlainDate) {
    return new Date(Date.UTC(value.year, value.month - 1, value.day));
  }
  return new Date(
    Date.UTC(
      value.year,
      value.month - 1,
      value.day,
      value.hour,
      value.minute,
      value.second,
      value.millisecond,
    ),
  );
}

function formatDate(locale: string, date: Temporal.PlainDate): string {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(utcDate(date));
}

function formatDateTime(locale: string, dateTime: Temporal.PlainDateTime): string {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(utcDate(dateTime));
}

/** The day heading's lead: "Wednesday". */
export function formatAgendaWeekday(locale: string, date: Temporal.PlainDate): string {
  return new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(
    utcDate(date),
  );
}

/** The day heading's rest: "11 Nov" (with the year for search results). */
export function formatAgendaDayLabel(
  locale: string,
  date: Temporal.PlainDate,
  withYear = false,
): string {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" as const } : {}),
    timeZone: "UTC",
  }).format(utcDate(date));
}

/** The day heading's accessible name: "Wednesday, 11 November 2026". */
export function formatAgendaLongDate(locale: string, date: Temporal.PlainDate): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "full", timeZone: "UTC" }).format(
    utcDate(date),
  );
}

/**
 * When an item runs on its day, as a start and (when it has one) an end line:
 * 17:45 / 19:54, All day / until 13 Nov, Continues / 10:00, 17:45 / 13 Nov…
 */
export function formatAgendaItemTimes(
  locale: string,
  item: AgendaItem,
): { start: string; end?: string } {
  const endDate = item.end.subtract({ nanoseconds: 1 }).toPlainDate();
  if (item.event.data.allDay === true) {
    return item.continuesToNextDay
      ? { start: "All day", end: `until ${formatDate(locale, endDate)}` }
      : { start: "All day" };
  }
  const time = (value: Temporal.PlainDateTime) => formatShortTime(locale, value);
  const start = item.continuesFromPreviousDay ? "Continues" : time(item.start);
  const end = item.continuesToNextDay ? formatDate(locale, endDate) : time(item.end);
  return { start, end };
}

/** When an item runs on its day: "17:45 - 19:54", "All day", "Continues - 10:00"… */
export function formatAgendaItemTime(locale: string, item: AgendaItem): string {
  if (item.event.data.allDay === true) {
    const startDate = item.start.toPlainDate();
    const endDate = item.end.subtract({ nanoseconds: 1 }).toPlainDate();
    if (Temporal.PlainDate.compare(startDate, endDate) === 0) {
      return item.continuesFromPreviousDay ? "All day (continues)" : "All day";
    }
    if (!item.continuesFromPreviousDay && item.continuesToNextDay) {
      return `All day - until ${formatDate(locale, endDate)}`;
    }
    if (item.continuesFromPreviousDay && !item.continuesToNextDay) {
      return `All day - ends ${formatDate(locale, endDate)}`;
    }
    return "All day (continues)";
  }

  const time = (value: Temporal.PlainDateTime) => formatShortTime(locale, value);
  if (Temporal.PlainDate.compare(item.start.toPlainDate(), item.end.toPlainDate()) === 0) {
    return `${time(item.start)} - ${time(item.end)}`;
  }
  if (!item.continuesFromPreviousDay && item.continuesToNextDay) {
    return `${time(item.start)} - continues`;
  }
  if (item.continuesFromPreviousDay && !item.continuesToNextDay) {
    return `Continues - ${time(item.end)}`;
  }
  if (item.continuesFromPreviousDay && item.continuesToNextDay) {
    return "Continues";
  }
  return `${formatDateTime(locale, item.start)} - ${formatDateTime(locale, item.end)}`;
}
