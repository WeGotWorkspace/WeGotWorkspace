import { Temporal } from "@js-temporal/polyfill";
import type {
  JSCalendarNDay,
  JSCalendarRecurrenceRule,
  JSCalendarWeekday,
} from "@/lib/jmap-client/jscalendar/types";

/**
 * Predefined recurrence presets for the event dialog.
 * Unmatched JSCalendar rules map to `"custom"` and are edited in the custom fields.
 */

export type RecurrencePresetId =
  | "none"
  | "daily"
  | "weekday"
  | "weekly"
  | "biweekly"
  | "monthly-date"
  | "monthly-nth"
  | "yearly"
  | "custom";

export type EditableRecurrencePresetId = Exclude<RecurrencePresetId, "custom">;

const ISO_TO_JS: Record<number, JSCalendarWeekday> = {
  1: "mo",
  2: "tu",
  3: "we",
  4: "th",
  5: "fr",
  6: "sa",
  7: "su",
};

const WEEKDAYS: JSCalendarWeekday[] = ["mo", "tu", "we", "th", "fr"];

function jsWeekday(date: Temporal.PlainDate): JSCalendarWeekday {
  return ISO_TO_JS[date.dayOfWeek] ?? "mo";
}

export function weekdayFromIsoDate(startDateISO: string): JSCalendarWeekday {
  return jsWeekday(Temporal.PlainDate.from(startDateISO));
}

/** 1–4 or -1 (last occurrence of that weekday in the month). */
export function nthWeekdayOfMonth(date: Temporal.PlainDate): number {
  const nth = Math.ceil(date.day / 7);
  if (date.day + 7 > date.daysInMonth) return -1;
  return nth;
}

function nDay(day: JSCalendarWeekday, nthOfPeriod?: number): JSCalendarNDay {
  return {
    "@type": "NDay",
    day,
    ...(nthOfPeriod !== undefined ? { nthOfPeriod } : {}),
  };
}

function rule(
  frequency: JSCalendarRecurrenceRule["frequency"],
  extras: Omit<JSCalendarRecurrenceRule, "@type" | "frequency"> = {},
): JSCalendarRecurrenceRule {
  return { "@type": "RecurrenceRule", frequency, ...extras };
}

/** Build the JSCalendar rule for an editable preset from the event start date. */
export function recurrencePresetToRule(
  preset: EditableRecurrencePresetId,
  startDateISO: string,
): JSCalendarRecurrenceRule | undefined {
  if (preset === "none") return undefined;
  const date = Temporal.PlainDate.from(startDateISO);
  const weekday = jsWeekday(date);
  switch (preset) {
    case "daily":
      return rule("daily");
    case "weekday":
      return rule("weekly", { byDay: WEEKDAYS.map((day) => nDay(day)) });
    case "weekly":
      return rule("weekly", { byDay: [nDay(weekday)] });
    case "biweekly":
      return rule("weekly", { interval: 2, byDay: [nDay(weekday)] });
    case "monthly-date":
      return rule("monthly", { byMonthDay: [date.day] });
    case "monthly-nth":
      return rule("monthly", { byDay: [nDay(weekday, nthWeekdayOfMonth(date))] });
    case "yearly":
      return rule("yearly", { byMonth: [String(date.month)], byMonthDay: [date.day] });
  }
}

function sortedDays(days: JSCalendarNDay[] | undefined): string[] {
  if (!days?.length) return [];
  return [...days].map((d) => `${d.day}:${d.nthOfPeriod ?? ""}`).sort((a, b) => a.localeCompare(b));
}

function sameNumberList(a: number[] | undefined, b: number[] | undefined): boolean {
  const left = [...(a ?? [])].sort((x, y) => x - y);
  const right = [...(b ?? [])].sort((x, y) => x - y);
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function sameMonthList(a: string[] | undefined, b: string[] | undefined): boolean {
  const left = [...(a ?? [])].map(String).sort();
  const right = [...(b ?? [])].map(String).sort();
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function intervalOf(ruleValue: JSCalendarRecurrenceRule): number {
  return ruleValue.interval === undefined || ruleValue.interval === 1 ? 1 : ruleValue.interval;
}

/** Drop series bounds so preset matching can ignore editable until/count. */
export function recurrenceRuleWithoutBounds(
  rule: JSCalendarRecurrenceRule,
): JSCalendarRecurrenceRule {
  const { count: _count, until: _until, ...rest } = rule;
  return rest;
}

/** Structural equality for the subset of fields our presets emit (and custom round-trips). */
export function recurrenceRulesEqual(
  a: JSCalendarRecurrenceRule | undefined,
  b: JSCalendarRecurrenceRule | undefined,
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.frequency !== b.frequency) return false;
  if (intervalOf(a) !== intervalOf(b)) return false;
  if (sortedDays(a.byDay).join("|") !== sortedDays(b.byDay).join("|")) return false;
  if (!sameNumberList(a.byMonthDay, b.byMonthDay)) return false;
  if (!sameMonthList(a.byMonth, b.byMonth)) return false;
  if ((a.count ?? null) !== (b.count ?? null)) return false;
  if ((a.until ?? null) !== (b.until ?? null)) return false;
  if (!sameNumberList(a.bySetPosition, b.bySetPosition)) return false;
  if (!sameNumberList(a.byHour, b.byHour)) return false;
  if (!sameNumberList(a.byMinute, b.byMinute)) return false;
  if (!sameNumberList(a.bySecond, b.bySecond)) return false;
  if (!sameNumberList(a.byYearDay, b.byYearDay)) return false;
  if (!sameNumberList(a.byWeekNo, b.byWeekNo)) return false;
  return true;
}

/** Preset shape equality — ignores until/count (edited separately in the dialog). */
export function recurrenceRuleMatchesPresetShape(
  wire: JSCalendarRecurrenceRule,
  expected: JSCalendarRecurrenceRule,
): boolean {
  return recurrenceRulesEqual(recurrenceRuleWithoutBounds(wire), expected);
}

const EDITABLE_PRESETS: EditableRecurrencePresetId[] = [
  "none",
  "daily",
  "weekday",
  "weekly",
  "biweekly",
  "monthly-date",
  "monthly-nth",
  "yearly",
];

/**
 * Match a wire rule (or absence) to a preset for the given start date.
 * Unmatched rules → `"custom"`. until/count alone do not force custom.
 */
export function matchRecurrencePreset(
  rules: JSCalendarRecurrenceRule[] | null | undefined,
  startDateISO: string,
): RecurrencePresetId {
  if (!rules?.length) return "none";
  if (rules.length !== 1) return "custom";
  const wire = rules[0]!;
  const shape = recurrenceRuleWithoutBounds(wire);
  for (const preset of EDITABLE_PRESETS) {
    if (preset === "none") continue;
    const expected = recurrencePresetToRule(preset, startDateISO);
    if (expected && recurrenceRuleMatchesPresetShape(wire, expected)) return preset;
  }
  // Bare weekly/yearly (no by*) still means "on the start date's weekday / month-day".
  if (
    shape.frequency === "weekly" &&
    intervalOf(shape) === 1 &&
    !shape.byDay?.length &&
    !shape.byMonthDay?.length &&
    !shape.byMonth?.length &&
    !shape.bySetPosition?.length
  ) {
    return "weekly";
  }
  if (
    shape.frequency === "yearly" &&
    intervalOf(shape) === 1 &&
    !shape.byDay?.length &&
    !shape.byMonthDay?.length &&
    !shape.byMonth?.length &&
    !shape.bySetPosition?.length
  ) {
    return "yearly";
  }
  return "custom";
}

export type RecurrencePresetLabels = {
  none: string;
  daily: string;
  weekday: string;
  weekly: (weekday: string) => string;
  biweekly: (weekday: string) => string;
  monthlyDate: (day: number) => string;
  monthlyNth: (nthLabel: string, weekday: string) => string;
  yearly: (monthDay: string) => string;
  custom: string;
};

export const defaultRecurrencePresetLabels: RecurrencePresetLabels = {
  none: "Does not repeat",
  daily: "Every day",
  weekday: "Every weekday (Monday to Friday)",
  weekly: (weekday) => `Every week on ${weekday}`,
  biweekly: (weekday) => `Every 2 weeks on ${weekday}`,
  monthlyDate: (day) => `Every month on the ${day}`,
  monthlyNth: (nthLabel, weekday) => `Every month on the ${nthLabel} ${weekday}`,
  yearly: (monthDay) => `Every year on ${monthDay}`,
  custom: "Custom",
};

function ordinalLabel(nth: number): string {
  if (nth === -1) return "last";
  if (nth === 1) return "first";
  if (nth === 2) return "second";
  if (nth === 3) return "third";
  if (nth === 4) return "fourth";
  return String(nth);
}

/** Locale-aware option labels for the recurrence select. */
export function recurrencePresetOptionLabel(
  preset: RecurrencePresetId,
  startDateISO: string,
  locale: string,
  labels: RecurrencePresetLabels = defaultRecurrencePresetLabels,
): string {
  if (preset === "none") return labels.none;
  if (preset === "daily") return labels.daily;
  if (preset === "weekday") return labels.weekday;
  if (preset === "custom") return labels.custom;

  const date = Temporal.PlainDate.from(startDateISO);
  const weekday = date.toLocaleString(locale, { weekday: "long" });

  if (preset === "weekly") return labels.weekly(weekday);
  if (preset === "biweekly") return labels.biweekly(weekday);
  if (preset === "monthly-date") return labels.monthlyDate(date.day);
  if (preset === "monthly-nth") {
    return labels.monthlyNth(ordinalLabel(nthWeekdayOfMonth(date)), weekday);
  }
  const monthDay = date.toLocaleString(locale, { month: "long", day: "numeric" });
  return labels.yearly(monthDay);
}

export const EDITABLE_RECURRENCE_PRESET_IDS: EditableRecurrencePresetId[] = [
  "none",
  "daily",
  "weekday",
  "weekly",
  "biweekly",
  "monthly-date",
  "monthly-nth",
  "yearly",
];
