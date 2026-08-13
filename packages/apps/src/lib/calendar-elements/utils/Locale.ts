import type { WeekdayNumber } from "../types/Weekday.js";

const DEFAULT_LOCALE = "en-US";

function isWeekdayNumber(value: number | undefined): value is WeekdayNumber {
  return Boolean(value && Number.isInteger(value) && value >= 1 && value <= 7);
}

export function resolveLocale(locale: string | null | undefined): string {
  if (locale?.trim()) return locale;
  if (typeof navigator !== "undefined" && navigator.language) return navigator.language;
  return DEFAULT_LOCALE;
}

export function getLocaleWeekInfo(locale: string | null | undefined): {
  firstDay?: WeekdayNumber;
  weekend: WeekdayNumber[];
} {
  const resolvedLocale = resolveLocale(locale);
  try {
    const localeInfo = new Intl.Locale(resolvedLocale) as Intl.Locale & {
      getWeekInfo?: () => { firstDay?: number; weekend?: number[] };
      weekInfo?: { firstDay?: number; weekend?: number[] };
    };
    const weekInfo = localeInfo.getWeekInfo?.() ?? localeInfo.weekInfo;
    const weekendDays = weekInfo?.weekend;
    const firstDay = isWeekdayNumber(weekInfo?.firstDay) ? weekInfo?.firstDay : undefined;
    const weekend = Array.isArray(weekendDays)
      ? weekendDays.filter((day): day is WeekdayNumber => isWeekdayNumber(day))
      : [];
    return { firstDay, weekend };
  } catch {
    return { weekend: [] };
  }
}

export function getLocaleDirection(locale: string | null | undefined): "ltr" | "rtl" {
  const resolvedLocale = resolveLocale(locale);
  try {
    const localeInfo = new Intl.Locale(resolvedLocale) as Intl.Locale & {
      textInfo?: { direction?: string };
      getTextInfo?: () => { direction?: string };
    };
    const direction = localeInfo.getTextInfo?.()?.direction ?? localeInfo.textInfo?.direction;
    if (direction === "rtl") return "rtl";
    if (direction === "ltr") return "ltr";
  } catch {
    // Fall through to default.
  }
  return "ltr";
}
