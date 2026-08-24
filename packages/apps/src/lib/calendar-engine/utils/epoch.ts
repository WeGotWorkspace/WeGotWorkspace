import { Temporal } from "@js-temporal/polyfill";

/** Floating UTC millis — same model as `rrule-adapter` `toUtcFloatingDate`. */
export function plainDateTimeToUtcMs(value: Temporal.PlainDateTime): number {
  return Date.UTC(
    value.year,
    value.month - 1,
    value.day,
    value.hour,
    value.minute,
    value.second,
    value.millisecond,
  );
}

export function utcMsToPlainDateTime(ms: number): Temporal.PlainDateTime {
  const date = new Date(ms);
  return Temporal.PlainDateTime.from({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
    millisecond: date.getUTCMilliseconds(),
  });
}

export function rangesOverlapMs(
  start: number,
  end: number,
  rangeStart: number,
  rangeEnd: number,
): boolean {
  return end > start && start < rangeEnd && end > rangeStart;
}
