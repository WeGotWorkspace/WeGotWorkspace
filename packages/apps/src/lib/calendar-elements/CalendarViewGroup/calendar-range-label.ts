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

function weekdayShort(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(date);
}

function weekRangeLabelParts(
  start: Temporal.PlainDate,
  end: Temporal.PlainDate,
  locale: string,
  density: CalendarRangeLabelDensity,
): CalendarRangeLabelPart[] {
  const startDate = utcDate(start);
  const endDate = utcDate(end);
  const yearText = new Intl.DateTimeFormat(locale, { year: "numeric", timeZone: "UTC" }).format(
    startDate,
  );

  if (density === "compact") {
    const startWeekday = weekdayShort(startDate, locale);
    const endWeekday = weekdayShort(endDate, locale);
    if (start.year === end.year && start.month === end.month) {
      const month = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(
        startDate,
      );
      return [
        { text: `${startWeekday} ${start.day}–${endWeekday} ${end.day} ${month} `, isYear: false },
        { text: yearText, isYear: true },
      ];
    }
    if (start.year === end.year) {
      const startPart = new Intl.DateTimeFormat(locale, {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }).format(startDate);
      const endPart = new Intl.DateTimeFormat(locale, {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }).format(endDate);
      return [
        { text: `${startWeekday} ${startPart} – ${endWeekday} ${endPart}, `, isYear: false },
        { text: yearText, isYear: true },
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
    const month = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(
      startDate,
    );
    return [
      { text: `${month} ${start.day}-${end.day}, `, isYear: false },
      { text: yearText, isYear: true },
    ];
  }

  if (start.year === end.year) {
    const startPart = new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(startDate);
    const endPart = new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(endDate);
    return [
      { text: `${startPart} - ${endPart}, `, isYear: false },
      { text: yearText, isYear: true },
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
    return [
      {
        text: new Intl.DateTimeFormat(locale, { year: "numeric", timeZone: "UTC" }).format(
          anchorDate,
        ),
        isYear: false,
      },
    ];
  }

  if (view === "month") {
    return dateLabelParts(
      new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }),
      new Date(Date.UTC(anchor.year, anchor.month - 1, 1)),
    );
  }

  if (view === "day") {
    const formatter = new Intl.DateTimeFormat(
      locale,
      density === "compact"
        ? { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }
        : {
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric",
            timeZone: "UTC",
          },
    );
    return dateLabelParts(formatter, anchorDate);
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
