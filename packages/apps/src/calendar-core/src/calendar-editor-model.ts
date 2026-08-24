import { Temporal } from "@js-temporal/polyfill";
import { resolveEventEnd, type CalendarEvent as EngineCalendarEvent } from "@/lib/calendar-engine";
import {
  internalRecurrenceRuleToJs,
  localToPlainDateTime,
  type JmapCalendarEvent,
  type JSCalendarRecurrenceRule,
} from "@/lib/jmap-client";
import {
  attendeesEqual,
  attendeesFromParticipants,
  type CalendarAttendee,
  type JmapParticipant,
} from "@/calendar-core/src/calendar-attendees";
import type { CalendarEventDraft, CalendarEventPatch } from "@/calendar-core/src/calendar-types";
import {
  alertMapsEqual,
  alertsFromWire,
  alertsToWire,
  DEFAULT_FREE_BUSY_STATUS,
  freeBusyStatusFromWire,
  type CalendarEventAlertFormValue,
  type CalendarFreeBusyStatus,
} from "@/calendar-core/src/calendar-alerts";
import {
  matchRecurrencePreset,
  recurrencePresetToRule,
  recurrenceRulesEqual,
  type RecurrencePresetId,
} from "@/calendar-core/src/calendar-recurrence-presets";
import {
  defaultTimedEventTimeZone,
  normalizeEventTimeZone,
} from "@/calendar-core/src/calendar-timezones";

export type {
  CalendarEventAlertFormValue,
  CalendarFreeBusyStatus,
} from "@/calendar-core/src/calendar-alerts";

/**
 * Pure form model for the event editor: JSCalendar wire <-> editable fields.
 * Recurring occurrence edits choose scope at Save
 * (`thisInstance` → recurrenceOverrides, `thisAndFuture` → truncate+fork).
 * Deletes separately offer `allInstances` → destroy master.
 */

/** Series end mode for editable recurrence presets. */
export type RecurrenceEndsMode = "never" | "until" | "count";

export type CalendarEventFormValue = {
  title: string;
  calendarId: string;
  allDay: boolean;
  /** YYYY-MM-DD */
  startDate: string;
  /** HH:MM (ignored when allDay) */
  startTime: string;
  endDate: string;
  endTime: string;
  /**
   * Timed events: IANA id, or `null` for floating/local wall (omit on create).
   * New timed events default to {@link defaultTimedEventTimeZone}.
   * Ignored on the wire when `allDay` (kept in the form so toggling all-day back restores it).
   */
  timeZone: string | null;
  location: string;
  description: string;
  /** JSCalendar `freeBusyStatus`. New events default to busy. */
  freeBusyStatus: CalendarFreeBusyStatus;
  /** Editor rows for the JSCalendar `alerts` map (empty = none). */
  alerts: CalendarEventAlertFormValue[];
  recurrencePreset: RecurrencePresetId;
  /**
   * How a repeating series ends. Ignored when preset is `"none"` or `"custom"`.
   * `"never"` omits both `until` and `count` on the wire.
   */
  recurrenceEnds: RecurrenceEndsMode;
  /** YYYY-MM-DD when `recurrenceEnds === "until"`. */
  recurrenceUntilDate: string;
  /** Occurrence count when `recurrenceEnds === "count"`. */
  recurrenceCount: number;
  /**
   * Preserved when `recurrencePreset` is `"custom"` so save does not wipe an
   * unmatched rule. Cleared when the user picks a predefined preset.
   */
  customRecurrenceRules?: JSCalendarRecurrenceRule[];
  attendees: CalendarAttendee[];
};

const DEFAULT_START_TIME = "10:00";
const DEFAULT_DURATION_MINUTES = 60;
/** Minimum timed span when coercing end ≤ start or leaving all-day. */
export const MIN_TIMED_DURATION_MINUTES = 30;
const DEFAULT_RECURRENCE_COUNT = 10;

function defaultRecurrenceEndsFields(
  startDateISO: string,
): Pick<CalendarEventFormValue, "recurrenceEnds" | "recurrenceUntilDate" | "recurrenceCount"> {
  return {
    recurrenceEnds: "never",
    recurrenceUntilDate: startDateISO,
    recurrenceCount: DEFAULT_RECURRENCE_COUNT,
  };
}

export function emptyCalendarEventForm(
  calendarId: string,
  dateISO: string,
  startTime: string = DEFAULT_START_TIME,
): CalendarEventFormValue {
  const start = Temporal.PlainDateTime.from(`${dateISO}T${startTime}:00`);
  const end = start.add({ minutes: DEFAULT_DURATION_MINUTES });
  return {
    title: "",
    calendarId,
    allDay: false,
    startDate: dateISO,
    startTime,
    endDate: end.toPlainDate().toString(),
    endTime: end.toPlainTime().toString({ smallestUnit: "minute" }),
    timeZone: defaultTimedEventTimeZone(),
    location: "",
    description: "",
    freeBusyStatus: DEFAULT_FREE_BUSY_STATUS,
    alerts: [],
    recurrencePreset: "none",
    attendees: [],
    ...defaultRecurrenceEndsFields(dateISO),
  };
}

function isMidnight(dateTime: Temporal.PlainDateTime): boolean {
  const time = dateTime.toPlainTime();
  return (
    time.hour === 0 &&
    time.minute === 0 &&
    time.second === 0 &&
    time.millisecond === 0 &&
    time.microsecond === 0 &&
    time.nanosecond === 0
  );
}

/**
 * Resolve all-day vs timed for a Lit create intent.
 * Wall-clock ranges (any non-midnight edge) are always timed — even if a flag was wrong.
 * Day-snapped midnight→midnight ranges are all-day unless explicitly marked timed.
 */
export function resolveCreateIntentAllDay(intent: {
  start: Temporal.PlainDateTime;
  end: Temporal.PlainDateTime;
  allDay?: boolean;
}): boolean {
  const daySnapped = isMidnight(intent.start) && isMidnight(intent.end);
  if (!daySnapped) return false;
  if (intent.allDay === false) return false;
  return intent.allDay === true || Temporal.PlainDateTime.compare(intent.end, intent.start) > 0;
}

/**
 * Prefill the create dialog from a Lit drag/click create intent.
 * All-day `end` is exclusive (same as the engine); the form shows the inclusive last day.
 */
export function createIntentToForm(
  calendarId: string,
  intent: {
    start: Temporal.PlainDateTime;
    end: Temporal.PlainDateTime;
    allDay?: boolean;
    title?: string;
  },
): CalendarEventFormValue {
  const allDay = resolveCreateIntentAllDay(intent);
  const formEnd = allDay ? intent.end.subtract({ days: 1 }) : intent.end;
  const startDate = intent.start.toPlainDate().toString();
  return {
    title: intent.title?.trim() ?? "",
    calendarId,
    allDay,
    startDate,
    startTime: intent.start.toPlainTime().toString({ smallestUnit: "minute" }),
    endDate: formEnd.toPlainDate().toString(),
    endTime: formEnd.toPlainTime().toString({ smallestUnit: "minute" }),
    timeZone: allDay ? null : defaultTimedEventTimeZone(),
    location: "",
    description: "",
    freeBusyStatus: DEFAULT_FREE_BUSY_STATUS,
    alerts: [],
    recurrencePreset: "none",
    attendees: [],
    ...defaultRecurrenceEndsFields(startDate),
  };
}

/**
 * Inverse of {@link createIntentToForm}: exclusive all-day end, wall-clock timed end.
 * Used to keep the drag-create preview card aligned with the open create dialog.
 */
export function formToCreateIntent(form: CalendarEventFormValue): {
  calendarId: string;
  allDay: boolean;
  start: Temporal.PlainDateTime;
  end: Temporal.PlainDateTime;
  title?: string;
} {
  const title = form.title.trim();
  return {
    calendarId: form.calendarId,
    allDay: form.allDay,
    start: formStart(form),
    end: formEndExclusive(form),
    ...(title ? { title } : {}),
  };
}

function primaryLocationName(event: JmapCalendarEvent): string {
  const locations = event.locations ?? {};
  const key = Object.keys(locations)[0];
  return key ? (locations[key]?.name ?? "") : "";
}

function untilDateFromWire(until: string | undefined): string | null {
  if (!until) return null;
  const datePart = until.slice(0, 10);
  try {
    Temporal.PlainDate.from(datePart);
    return datePart;
  } catch {
    return null;
  }
}

/** LocalDateTime `until` for the selected end date (inclusive last occurrence day). */
export function formRecurrenceUntilWire(form: CalendarEventFormValue): string {
  const date = form.recurrenceUntilDate;
  if (form.allDay) return `${date}T00:00:00`;
  return `${date}T${form.startTime}:00`;
}

function recurrenceFieldsFromRules(
  rules: JSCalendarRecurrenceRule[] | null | undefined,
  startDateISO: string,
): Pick<
  CalendarEventFormValue,
  | "recurrencePreset"
  | "customRecurrenceRules"
  | "recurrenceEnds"
  | "recurrenceUntilDate"
  | "recurrenceCount"
> {
  const preset = matchRecurrencePreset(rules, startDateISO);
  const defaults = defaultRecurrenceEndsFields(startDateISO);
  if (preset === "custom" && rules?.length) {
    return {
      recurrencePreset: "custom",
      customRecurrenceRules: rules,
      ...defaults,
    };
  }
  const rule = rules?.[0];
  const untilDate = untilDateFromWire(rule?.until);
  if (untilDate) {
    return {
      recurrencePreset: preset,
      recurrenceEnds: "until",
      recurrenceUntilDate: untilDate,
      recurrenceCount: defaults.recurrenceCount,
    };
  }
  if (rule?.count != null && rule.count > 0) {
    return {
      recurrencePreset: preset,
      recurrenceEnds: "count",
      recurrenceUntilDate: defaults.recurrenceUntilDate,
      recurrenceCount: rule.count,
    };
  }
  return { recurrencePreset: preset, ...defaults };
}

/** JSCalendar rules to persist for the current form recurrence selection. */
export function formRecurrenceRules(
  form: CalendarEventFormValue,
): JSCalendarRecurrenceRule[] | null {
  if (form.recurrencePreset === "custom") {
    return form.customRecurrenceRules?.length ? form.customRecurrenceRules : null;
  }
  if (form.recurrencePreset === "none") return null;
  const rule = recurrencePresetToRule(form.recurrencePreset, form.startDate);
  if (!rule) return null;
  if (form.recurrenceEnds === "until" && form.recurrenceUntilDate) {
    return [{ ...rule, until: formRecurrenceUntilWire(form) }];
  }
  if (form.recurrenceEnds === "count" && form.recurrenceCount >= 1) {
    return [{ ...rule, count: Math.floor(form.recurrenceCount) }];
  }
  return [rule];
}

export function calendarEventToForm(event: JmapCalendarEvent): CalendarEventFormValue {
  const allDay = event.showWithoutTime === true;
  const start = localToPlainDateTime(event.start);
  const duration = Temporal.Duration.from(event.duration ?? (allDay ? "P1D" : "PT1H"));
  const end = start.add(duration);
  // All-day events span [startDate, endDate); the form shows the inclusive last day.
  const formEnd = allDay ? end.subtract({ days: 1 }) : end;
  const startDate = start.toPlainDate().toString();
  return {
    title: event.title ?? "",
    calendarId: Object.keys(event.calendarIds ?? {})[0] ?? "",
    allDay,
    startDate,
    startTime: start.toPlainTime().toString({ smallestUnit: "minute" }),
    endDate: formEnd.toPlainDate().toString(),
    endTime: formEnd.toPlainTime().toString({ smallestUnit: "minute" }),
    timeZone: normalizeEventTimeZone(event.timeZone),
    location: primaryLocationName(event),
    description: typeof event.description === "string" ? event.description : "",
    freeBusyStatus: freeBusyStatusFromWire(event.freeBusyStatus),
    alerts: alertsFromWire(event.alerts),
    attendees: attendeesFromParticipants(
      event.participants as Record<string, JmapParticipant> | undefined,
    ),
    ...recurrenceFieldsFromRules(event.recurrenceRules, startDate),
  };
}

function formStart(form: CalendarEventFormValue): Temporal.PlainDateTime {
  return form.allDay
    ? Temporal.PlainDateTime.from(`${form.startDate}T00:00:00`)
    : Temporal.PlainDateTime.from(`${form.startDate}T${form.startTime}:00`);
}

function formEndExclusive(form: CalendarEventFormValue): Temporal.PlainDateTime {
  if (form.allDay) {
    // Inclusive last day in the form -> exclusive end on the wire.
    return Temporal.PlainDateTime.from(`${form.endDate}T00:00:00`).add({ days: 1 });
  }
  return Temporal.PlainDateTime.from(`${form.endDate}T${form.endTime}:00`);
}

function formatFormDate(dateTime: Temporal.PlainDateTime): string {
  return dateTime.toPlainDate().toString();
}

function formatFormTime(dateTime: Temporal.PlainDateTime): string {
  return dateTime.toPlainTime().toString({ smallestUnit: "minute" });
}

function withTimedEnd(
  form: CalendarEventFormValue,
  end: Temporal.PlainDateTime,
): CalendarEventFormValue {
  return {
    ...form,
    endDate: formatFormDate(end),
    endTime: formatFormTime(end),
  };
}

/**
 * Timed events: if end ≤ start, bump end to start + {@link MIN_TIMED_DURATION_MINUTES}.
 * All-day forms are unchanged.
 */
export function ensureTimedEndAfterStart(form: CalendarEventFormValue): CalendarEventFormValue {
  if (form.allDay) return form;
  try {
    const start = formStart(form);
    const end = formEndExclusive(form);
    if (Temporal.PlainDateTime.compare(end, start) > 0) return form;
    return withTimedEnd(form, start.add({ minutes: MIN_TIMED_DURATION_MINUTES }));
  } catch {
    return form;
  }
}

function timedDurationOrMin(form: CalendarEventFormValue): Temporal.Duration {
  try {
    const start = formStart(form);
    const end = formEndExclusive(form);
    const minutes = start.until(end).total({ unit: "minutes" });
    if (minutes > 0) {
      return Temporal.Duration.from({ minutes: Math.round(minutes) });
    }
  } catch {
    // fall through
  }
  return Temporal.Duration.from({ minutes: MIN_TIMED_DURATION_MINUTES });
}

/**
 * Apply a partial form update with editor UX rules:
 * - all-day → timed: end = start + 30 minutes
 * - timed start change: move (preserve prior duration)
 * - timed end ≤ start: coerce end to start + 30 minutes
 * - recurrence ends mode: default until date / count when switching modes
 * All-day date ranges keep existing date semantics (no auto-shift).
 */
export function patchCalendarEventForm(
  form: CalendarEventFormValue,
  patch: Partial<CalendarEventFormValue>,
): CalendarEventFormValue {
  const prevAllDay = form.allDay;
  let next: CalendarEventFormValue = { ...form, ...patch };
  const becameTimed = prevAllDay && next.allDay === false;
  const startMoved =
    !next.allDay &&
    (Object.prototype.hasOwnProperty.call(patch, "startDate") ||
      Object.prototype.hasOwnProperty.call(patch, "startTime"));
  const endEdited =
    !next.allDay &&
    (Object.prototype.hasOwnProperty.call(patch, "endDate") ||
      Object.prototype.hasOwnProperty.call(patch, "endTime"));

  if (Object.prototype.hasOwnProperty.call(patch, "recurrenceEnds")) {
    if (next.recurrenceEnds === "until" && !next.recurrenceUntilDate) {
      next = { ...next, recurrenceUntilDate: next.startDate };
    }
    if (
      next.recurrenceEnds === "count" &&
      (!(next.recurrenceCount >= 1) || !Number.isFinite(next.recurrenceCount))
    ) {
      next = { ...next, recurrenceCount: DEFAULT_RECURRENCE_COUNT };
    }
  }

  if (Object.prototype.hasOwnProperty.call(patch, "recurrencePreset")) {
    if (next.recurrencePreset === "none" || next.recurrencePreset === "custom") {
      next = { ...next, ...defaultRecurrenceEndsFields(next.startDate) };
    } else if (form.recurrencePreset === "none" || form.recurrencePreset === "custom") {
      // Entering an editable preset from none/custom → open-ended by default.
      next = { ...next, recurrenceEnds: "never" };
    }
  }

  if (becameTimed) {
    const timed: CalendarEventFormValue = {
      ...next,
      allDay: false,
      timeZone: next.timeZone ?? defaultTimedEventTimeZone(),
    };
    try {
      const start = formStart(timed);
      return withTimedEnd(timed, start.add({ minutes: MIN_TIMED_DURATION_MINUTES }));
    } catch {
      return timed;
    }
  }

  if (startMoved) {
    const duration = timedDurationOrMin({ ...form, allDay: false });
    try {
      const start = formStart(next);
      return ensureTimedEndAfterStart(withTimedEnd(next, start.add(duration)));
    } catch {
      return ensureTimedEndAfterStart(next);
    }
  }

  if (endEdited) {
    return ensureTimedEndAfterStart(next);
  }

  return next;
}

export function calendarEventFormIsValid(form: CalendarEventFormValue): boolean {
  if (!form.title.trim() || !form.calendarId || !form.startDate || !form.endDate) return false;
  if (!form.allDay && (!form.startTime || !form.endTime)) return false;
  const repeating = form.recurrencePreset !== "none" && form.recurrencePreset !== "custom";
  if (repeating) {
    if (form.recurrenceEnds === "until" && !form.recurrenceUntilDate) return false;
    if (
      form.recurrenceEnds === "count" &&
      (!Number.isFinite(form.recurrenceCount) || form.recurrenceCount < 1)
    ) {
      return false;
    }
  }
  try {
    return Temporal.PlainDateTime.compare(formEndExclusive(form), formStart(form)) > 0;
  } catch {
    return false;
  }
}

function formDuration(form: CalendarEventFormValue): string {
  const minutes = formStart(form).until(formEndExclusive(form)).total({ unit: "minutes" });
  if (form.allDay) {
    return Temporal.Duration.from({ days: Math.round(minutes / (24 * 60)) }).toString();
  }
  return Temporal.Duration.from({ minutes: Math.round(minutes) })
    .round({ largestUnit: "days" })
    .toString();
}

/** Timed wire `timeZone`: IANA string, or omitted when floating (`null` form value). */
function formWireTimeZone(form: CalendarEventFormValue): string | undefined {
  if (form.allDay) return undefined;
  const timeZone = normalizeEventTimeZone(form.timeZone);
  return timeZone ?? undefined;
}

export function formToDraft(form: CalendarEventFormValue): CalendarEventDraft {
  const start = formStart(form);
  const recurrenceRules = formRecurrenceRules(form);
  const timeZone = formWireTimeZone(form);
  const alerts = alertsToWire(form.alerts);
  return {
    calendarId: form.calendarId,
    title: form.title.trim(),
    start: start.toString({ smallestUnit: "second" }),
    duration: formDuration(form),
    ...(form.allDay ? { allDay: true } : {}),
    ...(timeZone ? { timeZone } : {}),
    ...(form.location.trim() ? { location: form.location.trim() } : {}),
    ...(form.description.trim() ? { description: form.description.trim() } : {}),
    freeBusyStatus: form.freeBusyStatus,
    ...(alerts ? { alerts } : {}),
    ...(recurrenceRules?.length ? { recurrenceRules } : {}),
    ...(form.attendees.length ? { attendees: form.attendees } : {}),
  };
}

export function formToPatch(
  form: CalendarEventFormValue,
  original: JmapCalendarEvent,
): CalendarEventPatch {
  const draft = formToDraft(form);
  const originalForm = calendarEventToForm(original);
  const patch: CalendarEventPatch = {};
  if (form.title.trim() !== (original.title ?? "")) patch.title = draft.title;
  if (form.calendarId !== originalForm.calendarId) patch.calendarId = draft.calendarId;
  if (draft.start !== original.start) patch.start = draft.start;
  if (draft.duration !== (original.duration ?? "")) patch.duration = draft.duration;
  if (form.allDay !== originalForm.allDay) patch.allDay = form.allDay;
  const nextTimeZone = form.allDay ? null : normalizeEventTimeZone(form.timeZone);
  const prevTimeZone = originalForm.allDay ? null : normalizeEventTimeZone(originalForm.timeZone);
  if (nextTimeZone !== prevTimeZone) {
    // Floating clears a fixed zone with explicit null (JMAP/JSCalendar patch semantics).
    patch.timeZone = nextTimeZone;
  }
  if (form.location.trim() !== originalForm.location) patch.location = form.location.trim();
  if (form.description.trim() !== originalForm.description) {
    patch.description = form.description.trim();
  }
  if (form.freeBusyStatus !== originalForm.freeBusyStatus) {
    patch.freeBusyStatus = form.freeBusyStatus;
  }
  const nextAlerts = alertsToWire(form.alerts);
  if (!alertMapsEqual(nextAlerts, original.alerts)) {
    patch.alerts = nextAlerts;
  }
  const nextRules = formRecurrenceRules(form);
  const prevRules = original.recurrenceRules ?? null;
  const prevNormalized = prevRules?.length ? prevRules : null;
  const nextNormalized = nextRules?.length ? nextRules : null;
  const sameRecurrence =
    prevNormalized === null && nextNormalized === null
      ? true
      : Boolean(
          prevNormalized &&
          nextNormalized &&
          prevNormalized.length === nextNormalized.length &&
          prevNormalized.length === 1 &&
          recurrenceRulesEqual(prevNormalized[0], nextNormalized[0]),
        );
  if (!sameRecurrence) {
    patch.recurrenceRules = nextNormalized;
  }
  if (!attendeesEqual(form.attendees, originalForm.attendees)) {
    patch.attendees = form.attendees;
  }
  return patch;
}

/**
 * Form from the adapter's engine model — used when the clicked event is not in
 * the bootstrap snapshot (e.g. just drag-created through the lit surface).
 */
export function engineEventToForm(event: EngineCalendarEvent): CalendarEventFormValue {
  const allDay = event.data.allDay === true;
  const start = event.data.start;
  const end = resolveEventEnd(event.data);
  const formEnd = allDay ? end.subtract({ days: 1 }) : end;
  const startDate = start.toPlainDate().toString();
  const wireRules = event.data.recurrenceRule
    ? [internalRecurrenceRuleToJs(event.data.recurrenceRule)]
    : undefined;
  return {
    title: event.data.summary,
    calendarId: event.calendarId ?? "",
    allDay,
    startDate,
    startTime: start.toPlainTime().toString({ smallestUnit: "minute" }),
    endDate: formEnd.toPlainDate().toString(),
    endTime: formEnd.toPlainTime().toString({ smallestUnit: "minute" }),
    timeZone: normalizeEventTimeZone(event.data.timeZone),
    location: event.data.location ?? "",
    description: "",
    freeBusyStatus: DEFAULT_FREE_BUSY_STATUS,
    alerts: [],
    attendees: [],
    ...recurrenceFieldsFromRules(wireRules, startDate),
  };
}

/** Full-field patch for edits whose wire original is unavailable (engine fallback). */
export function formToFullPatch(form: CalendarEventFormValue): CalendarEventPatch {
  const draft = formToDraft(form);
  return {
    title: draft.title,
    calendarId: draft.calendarId,
    start: draft.start,
    duration: draft.duration,
    allDay: form.allDay,
    timeZone: form.allDay ? null : normalizeEventTimeZone(form.timeZone),
    ...(form.location.trim() ? { location: form.location.trim() } : {}),
    ...(form.description.trim() ? { description: form.description.trim() } : {}),
    freeBusyStatus: form.freeBusyStatus,
    alerts: alertsToWire(form.alerts),
    recurrenceRules: formRecurrenceRules(form),
    ...(form.attendees.length ? { attendees: form.attendees } : {}),
  };
}
