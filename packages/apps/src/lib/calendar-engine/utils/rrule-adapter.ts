import { Temporal } from "@js-temporal/polyfill";
import { RRule, RRuleSet, type Options, type Weekday } from "rrule";
import type { CalendarRecurrenceRule } from "../types/calendar/index.js";
import type { CalendarEvent } from "../types/event.js";
import { parseRecurrenceId, toPlainDateTime } from "./recurrence.js";

type ExpandRecurringOptions = {
  /** Accepted for callers; expansion stays on JSCalendar local wall clocks. */
  timezone?: string;
};

const WEEKDAY_BY_CODE: Record<string, Weekday> = {
  MO: RRule.MO,
  TU: RRule.TU,
  WE: RRule.WE,
  TH: RRule.TH,
  FR: RRule.FR,
  SA: RRule.SA,
  SU: RRule.SU,
};

const FREQ_BY_CODE = {
  SECONDLY: RRule.SECONDLY,
  MINUTELY: RRule.MINUTELY,
  HOURLY: RRule.HOURLY,
  DAILY: RRule.DAILY,
  WEEKLY: RRule.WEEKLY,
  MONTHLY: RRule.MONTHLY,
  YEARLY: RRule.YEARLY,
} as const;

function toUtcFloatingDate(value: Temporal.PlainDateTime): Date {
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

function fromUtcFloatingDate(value: Date): Temporal.PlainDateTime {
  return Temporal.PlainDateTime.from({
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate(),
    hour: value.getUTCHours(),
    minute: value.getUTCMinutes(),
    second: value.getUTCSeconds(),
    millisecond: value.getUTCMilliseconds(),
  });
}

function toByWeekday(byDay: CalendarRecurrenceRule["byDay"]): Options["byweekday"] {
  if (!byDay?.length) return null;
  return byDay.map((rule) => {
    const weekday = WEEKDAY_BY_CODE[rule.day];
    return rule.ordinal !== undefined ? weekday.nth(rule.ordinal) : weekday;
  });
}

function toRRuleOptions(
  recurrenceRule: CalendarRecurrenceRule,
  dtstart: Temporal.PlainDateTime,
): Options {
  const monthlyNth = monthlyNthToBySetPos(recurrenceRule);
  const options: Options = {
    freq: FREQ_BY_CODE[recurrenceRule.freq],
    dtstart: toUtcFloatingDate(dtstart),
    interval: recurrenceRule.interval ?? 1,
    // JSCalendar `start` / recurrence-ids are LocalDateTime wall clocks.
    // Passing tzid through rrule shifts those clocks by the host offset
    // (10:00 → 11:00 in CET) so overrides and EXDATE keys no longer match.
    tzid: null,
    wkst: recurrenceRule.wkst ? WEEKDAY_BY_CODE[recurrenceRule.wkst] : null,
    bysecond: recurrenceRule.bySecond ?? null,
    byminute: recurrenceRule.byMinute ?? null,
    byhour: recurrenceRule.byHour ?? null,
    byweekday: monthlyNth ? monthlyNth.byweekday : toByWeekday(recurrenceRule.byDay),
    bymonthday: recurrenceRule.byMonthDay ?? null,
    bynmonthday: [],
    byyearday: recurrenceRule.byYearDay ?? null,
    byweekno: recurrenceRule.byWeekNo ?? null,
    bymonth: recurrenceRule.byMonth ?? null,
    bynweekday: null,
    bysetpos: monthlyNth ? monthlyNth.bysetpos : (recurrenceRule.bySetPos ?? null),
    byeaster: null,
    count: "count" in recurrenceRule ? (recurrenceRule.count ?? null) : null,
    until:
      "until" in recurrenceRule && recurrenceRule.until
        ? toUtcFloatingDate(toPlainDateTime(recurrenceRule.until))
        : null,
  };
  return options;
}

/**
 * `BYDAY=-1FR` (JSCalendar `nthOfPeriod`) and `BYDAY=FR;BYSETPOS=-1` are
 * equivalent monthly/yearly forms. rrule's `weekday.nth(-1)` misses instances
 * on multi-year `between` ranges; bysetpos does not.
 */
function monthlyNthToBySetPos(
  recurrenceRule: CalendarRecurrenceRule,
): { byweekday: Options["byweekday"]; bysetpos: number[] } | null {
  if (recurrenceRule.freq !== "MONTHLY" && recurrenceRule.freq !== "YEARLY") {
    return null;
  }
  if (recurrenceRule.bySetPos?.length) return null;
  const days = recurrenceRule.byDay;
  if (!days?.length) return null;
  const ordinals = [...new Set(days.map((day) => day.ordinal))];
  if (ordinals.length !== 1 || ordinals[0] === undefined) return null;
  return {
    byweekday: days.map((day) => WEEKDAY_BY_CODE[day.day]),
    bysetpos: [ordinals[0]],
  };
}

type MemoizedRule = {
  ruleSet: RRuleSet;
  betweenByRange: Map<string, Temporal.PlainDateTime[]>;
};

type PreparedRule = MemoizedRule & { rangeKey: string };

const ruleMemo = new WeakMap<CalendarEvent, MemoizedRule>();

function ruleSetFor(
  event: CalendarEvent,
  rangeStart: Temporal.PlainDateTime,
  rangeEnd: Temporal.PlainDateTime,
): PreparedRule | null {
  if (!event.data.recurrenceRule) return null;
  const dtstart = toPlainDateTime(event.data.start);
  const rangeKey = `${rangeStart.toString()}|${rangeEnd.toString()}`;
  const cached = ruleMemo.get(event);
  if (cached) return { ruleSet: cached.ruleSet, rangeKey, betweenByRange: cached.betweenByRange };

  const ruleSet = new RRuleSet();
  ruleSet.rrule(new RRule(toRRuleOptions(event.data.recurrenceRule, dtstart)));
  if (event.data.exclusionDates?.size) {
    for (const recurrenceId of event.data.exclusionDates) {
      const parsed = parseRecurrenceId(recurrenceId, event.data.allDay ?? false, event.data.start);
      if (!parsed) continue;
      ruleSet.exdate(toUtcFloatingDate(toPlainDateTime(parsed)));
    }
  }
  const memo: MemoizedRule = { ruleSet, betweenByRange: new Map() };
  ruleMemo.set(event, memo);
  return { ruleSet, rangeKey, betweenByRange: memo.betweenByRange };
}

export function expandRecurringStarts(
  event: CalendarEvent,
  rangeStart: Temporal.PlainDateTime,
  rangeEnd: Temporal.PlainDateTime,
  _options: ExpandRecurringOptions = {},
): Temporal.PlainDateTime[] {
  const prepared = ruleSetFor(event, rangeStart, rangeEnd);
  if (!prepared) return [];
  const cachedStarts = prepared.betweenByRange.get(prepared.rangeKey);
  if (cachedStarts) return cachedStarts;

  const starts = prepared.ruleSet
    .between(toUtcFloatingDate(rangeStart), toUtcFloatingDate(rangeEnd), true)
    .map(fromUtcFloatingDate);
  prepared.betweenByRange.set(prepared.rangeKey, starts);
  return starts;
}
