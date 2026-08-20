import type {
  JSCalendarRecurrenceRule,
  JSCalendarWeekday,
} from "@/lib/jmap-client/jscalendar/types";
import { Temporal } from "@js-temporal/polyfill";
import {
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

const WEEKDAY_ISO: Record<JSCalendarWeekday, number> = {
  mo: 1,
  tu: 2,
  we: 3,
  th: 4,
  fr: 5,
  sa: 6,
  su: 7,
};

/** Monday 2026-08-17 — used only to format weekday names. */
const WEEKDAY_LABEL_MONDAY = Temporal.PlainDate.from("2026-08-16");

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

export function customRecurrenceShowsByDay(rule: JSCalendarRecurrenceRule): boolean {
  return rule.frequency === "weekly" || rule.frequency === "monthly" || Boolean(rule.byDay?.length);
}

export function weekdayShortLabel(day: JSCalendarWeekday, locale: string): string {
  return WEEKDAY_LABEL_MONDAY.add({ days: WEEKDAY_ISO[day] }).toLocaleString(locale, {
    weekday: "short",
  });
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
      byDay: [{ "@type": "NDay", day: weekdayFromIsoDate(form.startDate) }],
    },
  ];
}

export function patchCustomRecurrenceRule(
  rule: JSCalendarRecurrenceRule,
  patch: Partial<Pick<JSCalendarRecurrenceRule, "frequency" | "interval" | "byDay">>,
  startDateISO: string,
): JSCalendarRecurrenceRule {
  const next: JSCalendarRecurrenceRule = { ...rule, ...patch };
  if (patch.interval !== undefined) {
    const interval = Math.floor(patch.interval);
    next.interval = interval <= 1 ? undefined : interval;
  }
  if (next.frequency === "weekly" && !next.byDay?.length) {
    next.byDay = [{ "@type": "NDay", day: weekdayFromIsoDate(startDateISO) }];
  }
  return next;
}

export function toggleCustomRecurrenceDay(
  rule: JSCalendarRecurrenceRule,
  day: JSCalendarWeekday,
): JSCalendarRecurrenceRule {
  const current = rule.byDay ?? [];
  const has = current.some((entry) => entry.day === day);
  const byDay = has
    ? current.filter((entry) => entry.day !== day)
    : [...current, { "@type": "NDay" as const, day }];
  if (rule.frequency === "weekly" && byDay.length === 0) return rule;
  return { ...rule, byDay: byDay.length ? byDay : undefined };
}
