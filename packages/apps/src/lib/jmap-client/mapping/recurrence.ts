import type {
  CalendarRecurrenceFrequency,
  CalendarRecurrenceRule,
  CalendarRecurrenceWeekday,
  CalendarRecurrenceWeekdayRule,
} from "@/lib/calendar-engine";
import type {
  JSCalendarNDay,
  JSCalendarRecurrenceRule,
  JSCalendarWeekday,
} from "../jscalendar/types.js";
import { localToPlainDateTime, plainDateTimeToLocal } from "./datetime.js";

const WEEKDAY_TO_INTERNAL: Record<JSCalendarWeekday, CalendarRecurrenceWeekday> = {
  mo: "MO",
  tu: "TU",
  we: "WE",
  th: "TH",
  fr: "FR",
  sa: "SA",
  su: "SU",
};

const WEEKDAY_TO_JS: Record<CalendarRecurrenceWeekday, JSCalendarWeekday> = {
  MO: "mo",
  TU: "tu",
  WE: "we",
  TH: "th",
  FR: "fr",
  SA: "sa",
  SU: "su",
};

/**
 * JSCalendar RecurrenceRule -> internal CalendarRecurrenceRule. Non-Gregorian `rscale`
 * refinements (e.g. leap-month "5L" in byMonth) cannot be represented internally and are
 * skipped; the full original rule is still preserved on the wire object for round-trips.
 */
export function jsRecurrenceRuleToInternal(
  rule: JSCalendarRecurrenceRule,
): CalendarRecurrenceRule | undefined {
  const freq = rule.frequency?.toUpperCase() as CalendarRecurrenceFrequency | undefined;
  if (!freq) return undefined;

  const byDay = rule.byDay
    ?.map((nDay: JSCalendarNDay): CalendarRecurrenceWeekdayRule | undefined => {
      const day = WEEKDAY_TO_INTERNAL[nDay.day];
      if (!day) return undefined;
      return nDay.nthOfPeriod !== undefined ? { day, ordinal: nDay.nthOfPeriod } : { day };
    })
    .filter((entry): entry is CalendarRecurrenceWeekdayRule => entry !== undefined);

  const byMonth = rule.byMonth
    ?.map((month) => Number.parseInt(month, 10))
    .filter((month) => Number.isInteger(month) && month >= 1 && month <= 12);

  const base: CalendarRecurrenceRule = {
    freq,
    ...(rule.interval !== undefined && rule.interval !== 1 ? { interval: rule.interval } : {}),
    ...(rule.firstDayOfWeek ? { wkst: WEEKDAY_TO_INTERNAL[rule.firstDayOfWeek] } : {}),
    ...(byDay?.length ? { byDay } : {}),
    ...(rule.byMonthDay?.length ? { byMonthDay: rule.byMonthDay } : {}),
    ...(byMonth?.length ? { byMonth } : {}),
    ...(rule.byYearDay?.length ? { byYearDay: rule.byYearDay } : {}),
    ...(rule.byWeekNo?.length ? { byWeekNo: rule.byWeekNo } : {}),
    ...(rule.byHour?.length ? { byHour: rule.byHour } : {}),
    ...(rule.byMinute?.length ? { byMinute: rule.byMinute } : {}),
    ...(rule.bySecond?.length ? { bySecond: rule.bySecond } : {}),
    ...(rule.bySetPosition?.length ? { bySetPos: rule.bySetPosition } : {}),
  };

  if (rule.count !== undefined) return { ...base, count: rule.count };
  if (rule.until !== undefined) return { ...base, until: localToPlainDateTime(rule.until) };
  return base;
}

/** Internal CalendarRecurrenceRule -> JSCalendar RecurrenceRule. */
export function internalRecurrenceRuleToJs(rule: CalendarRecurrenceRule): JSCalendarRecurrenceRule {
  const result: JSCalendarRecurrenceRule = {
    "@type": "RecurrenceRule",
    frequency: rule.freq.toLowerCase() as JSCalendarRecurrenceRule["frequency"],
  };
  if (rule.interval !== undefined && rule.interval !== 1) result.interval = rule.interval;
  if (rule.wkst) result.firstDayOfWeek = WEEKDAY_TO_JS[rule.wkst];
  if (rule.byDay?.length) {
    result.byDay = rule.byDay.map((entry) => ({
      "@type": "NDay",
      day: WEEKDAY_TO_JS[entry.day],
      ...(entry.ordinal !== undefined ? { nthOfPeriod: entry.ordinal } : {}),
    }));
  }
  if (rule.byMonthDay?.length) result.byMonthDay = rule.byMonthDay;
  if (rule.byMonth?.length) result.byMonth = rule.byMonth.map((month) => String(month));
  if (rule.byYearDay?.length) result.byYearDay = rule.byYearDay;
  if (rule.byWeekNo?.length) result.byWeekNo = rule.byWeekNo;
  if (rule.byHour?.length) result.byHour = rule.byHour;
  if (rule.byMinute?.length) result.byMinute = rule.byMinute;
  if (rule.bySecond?.length) result.bySecond = rule.bySecond;
  if (rule.bySetPos?.length) result.bySetPosition = rule.bySetPos;
  if (rule.count !== undefined) result.count = rule.count;
  if (rule.until !== undefined) result.until = plainDateTimeToLocal(rule.until);
  return result;
}
