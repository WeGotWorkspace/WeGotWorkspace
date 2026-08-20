import { Temporal } from "@js-temporal/polyfill";
import type { CalendarViewMode } from "../types/CalendarViewGroup.js";

export type CalendarRangeLabelPart = {
  text: string;
  isYear: boolean;
};

export type CalendarRangeLabelDensity = "full" | "compact";

export type CalendarRangeLabelInput = {
  view: CalendarViewMode;
  anchor: Temporal.PlainDate;
  locale: string;
  density?: CalendarRangeLabelDensity;
  /** Inclusive week window when `view` is `"week"`. */
  weekStart?: Temporal.PlainDate;
  weekEnd?: Temporal.PlainDate;
};

function utcDate(date: Temporal.PlainDate): Date {
  return new Date(Date.UTC(date.year, date.month - 1, date.day));
}

function dateLabelParts(formatter: Intl.DateTimeFormat, date: Date): CalendarRangeLabelPart[] {
  return formatter.formatToParts(date).map((part) => ({
    text: part.value,
    isYear: part.type === "year",
  }));
}

function weekdayName(date: Date, locale: string, width: "long" | "short"): string {
  return new Intl.DateTimeFormat(locale, { weekday: width, timeZone: "UTC" }).format(date);
}

function yearText(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { year: "numeric", timeZone: "UTC" }).format(date);
}

function monthShort(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(date);
}

function monthDay(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/** Day titles always include a weekday (long on large headers, short when compact). */
function dayLabelParts(
  date: Date,
  locale: string,
  density: CalendarRangeLabelDensity,
): CalendarRangeLabelPart[] {
  const weekdayWidth = density === "compact" ? "short" : "long";
  const monthWidth = density === "compact" ? "short" : "long";
  return [
    { text: `${weekdayName(date, locale, weekdayWidth)}, `, isYear: false },
    ...dateLabelParts(
      new Intl.DateTimeFormat(locale, {
        month: monthWidth,
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      }),
      date,
    ),
  ];
}

function weekRangeLabelParts(
  start: Temporal.PlainDate,
  end: Temporal.PlainDate,
  locale: string,
  density: CalendarRangeLabelDensity,
): CalendarRangeLabelPart[] {
  const startDate = utcDate(start);
  const endDate = utcDate(end);
  const year = yearText(startDate, locale);

  if (density === "compact") {
    const startWeekday = weekdayName(startDate, locale, "short");
    const endWeekday = weekdayName(endDate, locale, "short");
    if (start.year === end.year && start.month === end.month) {
      return [
        {
          text: `${startWeekday} ${start.day}–${endWeekday} ${end.day} ${monthShort(startDate, locale)} `,
          isYear: false,
        },
        { text: year, isYear: true },
      ];
    }
    if (start.year === end.year) {
      return [
        {
          text: `${startWeekday} ${monthDay(startDate, locale)} – ${endWeekday} ${monthDay(endDate, locale)}, `,
          isYear: false,
        },
        { text: year, isYear: true },
      ];
    }
    const compactDate = new Intl.DateTimeFormat(locale, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
    return [
      ...dateLabelParts(compactDate, startDate),
      { text: " – ", isYear: false },
      ...dateLabelParts(compactDate, endDate),
    ];
  }

  if (start.year === end.year && start.month === end.month) {
    return [
      { text: `${monthShort(startDate, locale)} ${start.day}-${end.day}, `, isYear: false },
      { text: year, isYear: true },
    ];
  }

  if (start.year === end.year) {
    return [
      {
        text: `${monthDay(startDate, locale)} - ${monthDay(endDate, locale)}, `,
        isYear: false,
      },
      { text: year, isYear: true },
    ];
  }

  const mediumDateFormatter = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: "UTC",
  });
  return [
    ...dateLabelParts(mediumDateFormatter, startDate),
    { text: " - ", isYear: false },
    ...dateLabelParts(mediumDateFormatter, endDate),
  ];
}

/** Locale-aware calendar header range (day / week / month / year). */
export function calendarRangeLabelParts({
  view,
  anchor,
  locale,
  density = "full",
  weekStart,
  weekEnd,
}: CalendarRangeLabelInput): CalendarRangeLabelPart[] {
  const anchorDate = utcDate(anchor);

  if (view === "year") {
    return [{ text: yearText(anchorDate, locale), isYear: false }];
  }

  if (view === "month") {
    return dateLabelParts(
      new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }),
      new Date(Date.UTC(anchor.year, anchor.month - 1, 1)),
    );
  }

  if (view === "day") {
    return dayLabelParts(anchorDate, locale, density);
  }

  const start = weekStart ?? anchor;
  const end = weekEnd ?? start.add({ days: 6 });
  return weekRangeLabelParts(start, end, locale, density);
}

export function calendarRangeLabel(input: CalendarRangeLabelInput): string {
  return calendarRangeLabelParts(input)
    .map((part) => part.text)
    .join("");
}
