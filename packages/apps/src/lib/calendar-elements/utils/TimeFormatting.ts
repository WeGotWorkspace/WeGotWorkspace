import { Temporal } from "@js-temporal/polyfill";
import { resolveLocale } from "./Locale.js";

type TimeLike = Temporal.PlainTime | Temporal.PlainDateTime;

const dateTimeFormats = new Map<string, Intl.DateTimeFormat>();

/**
 * One `Intl.DateTimeFormat` per locale and options. Building one is costly, and a long
 * agenda formats every row's times on each render.
 */
export function cachedDateTimeFormat(
  locale: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let format = dateTimeFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(locale, options);
    dateTimeFormats.set(key, format);
  }
  return format;
}

export function formatShortTime(
  lang: string | null | undefined,
  value: TimeLike | null | undefined,
): string {
  if (!value) return "";
  const { hour, minute, second } = value;
  // A wall-clock time read as UTC, so the formatter's own zone cannot shift it.
  return cachedDateTimeFormat(resolveLocale(lang), { timeStyle: "short", timeZone: "UTC" }).format(
    Date.UTC(1970, 0, 1, hour, minute, second),
  );
}

export function formatShortTimeRange(
  lang: string | null | undefined,
  start: TimeLike | null | undefined,
  end: TimeLike | null | undefined,
): string {
  const startLabel = formatShortTime(lang, start);
  const endLabel = formatShortTime(lang, end);
  if (!startLabel || !endLabel) return "";
  return `${startLabel} - ${endLabel}`;
}

/** Whether the locale writes times on a 12-hour clock (AM / PM). */
function usesTwelveHourClock(locale: string): boolean {
  const { hourCycle } = new Intl.DateTimeFormat(locale, { hour: "numeric" }).resolvedOptions();
  return hourCycle === "h11" || hourCycle === "h12";
}

/**
 * An hour label for the time gutter: "13:00" on a 24-hour clock, "1 PM" on a 12-hour one
 * (the minutes are always :00, so they are left out).
 */
export function formatHourLabel(lang: string | null | undefined, hour: number): string {
  const resolvedLocale = resolveLocale(lang);
  const time = Temporal.PlainTime.from({ hour: hour % 24, minute: 0 });
  return usesTwelveHourClock(resolvedLocale)
    ? time.toLocaleString(resolvedLocale, { hour: "numeric" })
    : time.toLocaleString(resolvedLocale, { timeStyle: "short" });
}

export function getHourlyTimeLabels(
  lang: string | null | undefined,
  hours = 24,
  startHour = 0,
): string[] {
  const clampedHours = Math.max(0, Math.floor(Number(hours) || 0));
  const base = Math.max(0, Math.floor(Number(startHour) || 0));

  return Array.from({ length: clampedHours }, (_, index) => formatHourLabel(lang, base + index));
}
