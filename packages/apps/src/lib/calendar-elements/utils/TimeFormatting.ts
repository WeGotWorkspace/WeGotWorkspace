import { Temporal } from "@js-temporal/polyfill";
import { resolveLocale } from "./Locale.js";

type TimeLike = Temporal.PlainTime | Temporal.PlainDateTime;

export function formatShortTime(
  lang: string | null | undefined,
  value: TimeLike | null | undefined,
): string {
  if (!value) return "";
  const resolvedLocale = resolveLocale(lang);
  const plainTime = value instanceof Temporal.PlainDateTime ? value.toPlainTime() : value;
  return plainTime.toLocaleString(resolvedLocale, { timeStyle: "short" });
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

export function getHourlyTimeLabels(
  lang: string | null | undefined,
  hours = 24,
  startHour = 0,
): string[] {
  const clampedHours = Math.max(0, Math.floor(Number(hours) || 0));
  const base = Math.max(0, Math.floor(Number(startHour) || 0));

  return Array.from({ length: clampedHours }, (_, index) =>
    formatShortTime(lang, Temporal.PlainTime.from({ hour: (base + index) % 24, minute: 0 })),
  );
}
