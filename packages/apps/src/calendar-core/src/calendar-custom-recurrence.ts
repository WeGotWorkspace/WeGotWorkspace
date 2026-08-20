import type {
  JSCalendarNDay,
  JSCalendarRecurrenceRule,
  JSCalendarWeekday,
} from "@/lib/jmap-client/jscalendar/types";
import { Temporal } from "@js-temporal/polyfill";
import {
  nthWeekdayOfMonth,
  recurrencePresetToRule,
  weekdayFromIsoDate,
  type RecurrencePresetId,
} from "@/calendar-core/src/calendar-recurrence-presets";

export const CUSTOM_RECURRENCE_FREQUENCIES = ["daily", "weekly", "monthly", "yearly"] as const;

export type CustomRecurrenceFrequency = (typeof CUSTOM_RECURRENCE_FREQUENCIES)[number];

export const CUSTOM_RECURRENCE_WEEKDAYS: readonly JSCalendarWeekday[] = [
  "mo",
  "tu",
  "we",
  "th",
  "fr",
  "sa",
  "su",
];

export const CUSTOM_RECURRENCE_WEEKDAY_DAYS: readonly JSCalendarWeekday[] = [
  "mo",
  "tu",
  "we",
  "th",
  "fr",
];

export const CUSTOM_RECURRENCE_WEEKEND_DAYS: readonly JSCalendarWeekday[] = ["sa", "su"];

export const CUSTOM_RECURRENCE_MONTH_DAYS: readonly number[] = Array.from(
  { length: 31 },
  (_, index) => index + 1,
);

export const CUSTOM_RECURRENCE_MONTHS: readonly number[] = Array.from(
  { length: 12 },
  (_, index) => index + 1,
);

export const CUSTOM_RECURRENCE_ORDINALS = [1, 2, 3, 4, 5, -1] as const;

export type CustomRecurrenceOrdinal = (typeof CUSTOM_RECURRENCE_ORDINALS)[number];

export type CustomRecurrenceDayKind = JSCalendarWeekday | "day" | "weekday" | "weekend";

export const CUSTOM_RECURRENCE_DAY_KINDS: readonly CustomRecurrenceDayKind[] = [
  ...CUSTOM_RECURRENCE_WEEKDAYS,
  "day",
  "weekday",
  "weekend",
];

export type CustomRecurrenceRepeatMode =
  | "none"
  | "by-day"
  | "month-days"
  | "year-months"
  | "ordinal";

const WEEKDAY_ISO: Record<JSCalendarWeekday, number> = {
  mo: 1,
  tu: 2,
  we: 3,
  th: 4,
  fr: 5,
  sa: 6,
  su: 7,
};

const SPECIAL_DAY_KIND_DAYS: Record<"day" | "weekday" | "weekend", readonly JSCalendarWeekday[]> = {
  day: CUSTOM_RECURRENCE_WEEKDAYS,
  weekday: CUSTOM_RECURRENCE_WEEKDAY_DAYS,
  weekend: CUSTOM_RECURRENCE_WEEKEND_DAYS,
};

/** Monday 2026-08-17 — used only to format weekday names. */
const WEEKDAY_LABEL_MONDAY = Temporal.PlainDate.from("2026-08-16");

function nDay(day: JSCalendarWeekday, nthOfPeriod?: number): JSCalendarNDay {
  return {
    "@type": "NDay",
    day,
    ...(nthOfPeriod !== undefined ? { nthOfPeriod } : {}),
  };
}

function sameWeekdays(
  days: readonly JSCalendarWeekday[],
  expected: readonly JSCalendarWeekday[],
): boolean {
  if (days.length !== expected.length) return false;
  const set = new Set(days);
  return expected.every((day) => set.has(day));
}

function isSpecialDayKind(kind: CustomRecurrenceDayKind): kind is "day" | "weekday" | "weekend" {
  return kind === "day" || kind === "weekday" || kind === "weekend";
}

function isOrdinalNth(value: number | undefined): value is CustomRecurrenceOrdinal {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5 || value === -1;
}

function isOrdinalRule(rule: JSCalendarRecurrenceRule): boolean {
  if (rule.bySetPosition?.length) return true;
  if (rule.byDay?.some((entry) => entry.nthOfPeriod != null)) return true;
  return Boolean(rule.byDay?.length) && !rule.byMonthDay?.length && !rule.byMonth?.length;
}

export function isCustomRecurrenceFrequency(
  value: JSCalendarRecurrenceRule["frequency"],
): value is CustomRecurrenceFrequency {
  return (CUSTOM_RECURRENCE_FREQUENCIES as readonly string[]).includes(value);
}

export function customRecurrenceFrequencyOptions(
  current: JSCalendarRecurrenceRule["frequency"],
): JSCalendarRecurrenceRule["frequency"][] {
  if (isCustomRecurrenceFrequency(current)) {
    return [...CUSTOM_RECURRENCE_FREQUENCIES];
  }
  return [current, ...CUSTOM_RECURRENCE_FREQUENCIES];
}

export function customRecurrenceInterval(rule: JSCalendarRecurrenceRule): number {
  return rule.interval === undefined || rule.interval < 1 ? 1 : Math.floor(rule.interval);
}

export function customRecurrenceRepeatMode(
  rule: JSCalendarRecurrenceRule,
): CustomRecurrenceRepeatMode {
  if (rule.frequency === "weekly") return "by-day";
  if (rule.frequency === "monthly") return isOrdinalRule(rule) ? "ordinal" : "month-days";
  if (rule.frequency === "yearly") return isOrdinalRule(rule) ? "ordinal" : "year-months";
  return "none";
}

export function customRecurrenceShowsByDay(rule: JSCalendarRecurrenceRule): boolean {
  return customRecurrenceRepeatMode(rule) === "by-day";
}

export function weekdayShortLabel(day: JSCalendarWeekday, locale: string): string {
  return WEEKDAY_LABEL_MONDAY.add({ days: WEEKDAY_ISO[day] }).toLocaleString(locale, {
    weekday: "short",
  });
}

export function monthShortLabel(month: number, locale: string): string {
  return Temporal.PlainDate.from({ year: 2026, month, day: 1 }).toLocaleString(locale, {
    month: "short",
  });
}

export function monthLongLabel(month: number, locale: string): string {
  return Temporal.PlainDate.from({ year: 2026, month, day: 1 }).toLocaleString(locale, {
    month: "long",
  });
}

export function customRecurrenceOrdinal(rule: JSCalendarRecurrenceRule): CustomRecurrenceOrdinal {
  const fromSet = rule.bySetPosition?.[0];
  if (isOrdinalNth(fromSet)) return fromSet;
  const nth = rule.byDay?.[0]?.nthOfPeriod;
  if (isOrdinalNth(nth)) return nth;
  return 1;
}

export function customRecurrenceDayKind(rule: JSCalendarRecurrenceRule): CustomRecurrenceDayKind {
  const days = (rule.byDay ?? []).map((entry) => entry.day);
  if (sameWeekdays(days, SPECIAL_DAY_KIND_DAYS.day)) return "day";
  if (sameWeekdays(days, SPECIAL_DAY_KIND_DAYS.weekday)) return "weekday";
  if (sameWeekdays(days, SPECIAL_DAY_KIND_DAYS.weekend)) return "weekend";
  return days[0] ?? "mo";
}

export function seedCustomRecurrenceRules(form: {
  recurrencePreset: RecurrencePresetId;
  startDate: string;
  customRecurrenceRules?: JSCalendarRecurrenceRule[];
}): JSCalendarRecurrenceRule[] {
  if (form.recurrencePreset === "custom" && form.customRecurrenceRules?.length) {
    return form.customRecurrenceRules;
  }
  if (form.recurrencePreset !== "none" && form.recurrencePreset !== "custom") {
    const rule = recurrencePresetToRule(form.recurrencePreset, form.startDate);
    if (rule) return [rule];
  }
  return [
    {
      "@type": "RecurrenceRule",
      frequency: "weekly",
      byDay: [nDay(weekdayFromIsoDate(form.startDate))],
    },
  ];
}

function seedFrequencyFields(
  rule: JSCalendarRecurrenceRule,
  startDateISO: string,
): JSCalendarRecurrenceRule {
  const start = Temporal.PlainDate.from(startDateISO);
  const weekday = weekdayFromIsoDate(startDateISO);
  const {
    byDay: _byDay,
    byMonthDay: _byMonthDay,
    byMonth: _byMonth,
    bySetPosition: _pos,
    ...rest
  } = rule;
  if (rule.frequency === "weekly") {
    return { ...rest, byDay: [nDay(weekday)] };
  }
  if (rule.frequency === "monthly") {
    return { ...rest, byMonthDay: [start.day] };
  }
  if (rule.frequency === "yearly") {
    return { ...rest, byMonth: [String(start.month)], byMonthDay: [start.day] };
  }
  return rest;
}

export function patchCustomRecurrenceRule(
  rule: JSCalendarRecurrenceRule,
  patch: Partial<
    Pick<
      JSCalendarRecurrenceRule,
      "frequency" | "interval" | "byDay" | "byMonthDay" | "byMonth" | "bySetPosition"
    >
  >,
  startDateISO: string,
): JSCalendarRecurrenceRule {
  const next: JSCalendarRecurrenceRule = { ...rule, ...patch };
  if (patch.interval !== undefined) {
    const interval = Math.floor(patch.interval);
    next.interval = interval <= 1 ? undefined : interval;
  }
  if (patch.frequency !== undefined && patch.frequency !== rule.frequency) {
    return seedFrequencyFields(next, startDateISO);
  }
  if (next.frequency === "weekly" && !next.byDay?.length) {
    next.byDay = [nDay(weekdayFromIsoDate(startDateISO))];
  }
  return next;
}

export function toggleCustomRecurrenceDay(
  rule: JSCalendarRecurrenceRule,
  day: JSCalendarWeekday,
): JSCalendarRecurrenceRule {
  const current = rule.byDay ?? [];
  const has = current.some((entry) => entry.day === day);
  const byDay = has ? current.filter((entry) => entry.day !== day) : [...current, nDay(day)];
  if (rule.frequency === "weekly" && byDay.length === 0) return rule;
  return { ...rule, byDay: byDay.length ? byDay : undefined };
}

export function toggleCustomRecurrenceMonthDay(
  rule: JSCalendarRecurrenceRule,
  day: number,
): JSCalendarRecurrenceRule {
  const current = rule.byMonthDay ?? [];
  const has = current.includes(day);
  const byMonthDay = has ? current.filter((entry) => entry !== day) : [...current, day];
  if (byMonthDay.length === 0) return rule;
  return { ...rule, byMonthDay };
}

export function toggleCustomRecurrenceMonth(
  rule: JSCalendarRecurrenceRule,
  month: number,
): JSCalendarRecurrenceRule {
  const key = String(month);
  const current = rule.byMonth ?? [];
  const has = current.includes(key);
  const byMonth = has ? current.filter((entry) => entry !== key) : [...current, key];
  if (byMonth.length === 0) return rule;
  return { ...rule, byMonth };
}

export function patchCustomRecurrenceOrdinal(
  rule: JSCalendarRecurrenceRule,
  patch: { nth?: CustomRecurrenceOrdinal; kind?: CustomRecurrenceDayKind },
  startDateISO: string,
): JSCalendarRecurrenceRule {
  const nth = patch.nth ?? customRecurrenceOrdinal(rule);
  const kind =
    patch.kind ??
    (rule.byDay?.length ? customRecurrenceDayKind(rule) : weekdayFromIsoDate(startDateISO));
  const { byMonthDay: _byMonthDay, bySetPosition: _pos, ...rest } = rule;
  if (isSpecialDayKind(kind)) {
    return {
      ...rest,
      byDay: SPECIAL_DAY_KIND_DAYS[kind].map((day) => nDay(day)),
      bySetPosition: [nth],
    };
  }
  return {
    ...rest,
    byDay: [nDay(kind, nth)],
    bySetPosition: undefined,
  };
}

export function setCustomRecurrenceRepeatMode(
  rule: JSCalendarRecurrenceRule,
  mode: "month-days" | "year-months" | "ordinal",
  startDateISO: string,
): JSCalendarRecurrenceRule {
  const start = Temporal.PlainDate.from(startDateISO);
  if (mode === "month-days") {
    const { byDay: _byDay, bySetPosition: _pos, ...rest } = rule;
    return {
      ...rest,
      byMonthDay: rest.byMonthDay?.length ? rest.byMonthDay : [start.day],
    };
  }
  if (mode === "year-months") {
    const { byDay: _byDay, bySetPosition: _pos, ...rest } = rule;
    return {
      ...rest,
      byMonth: rest.byMonth?.length ? rest.byMonth : [String(start.month)],
      byMonthDay: rest.byMonthDay?.length ? rest.byMonthDay : [start.day],
    };
  }
  const { byMonthDay: _byMonthDay, ...rest } = rule;
  if (customRecurrenceRepeatMode({ ...rest, byMonthDay: undefined }) === "ordinal") {
    return { ...rest, byMonthDay: undefined };
  }
  return patchCustomRecurrenceOrdinal(
    { ...rest, byDay: undefined, bySetPosition: undefined, byMonthDay: undefined },
    {
      nth: nthWeekdayOfMonth(start),
      kind: weekdayFromIsoDate(startDateISO),
    },
    startDateISO,
  );
}
