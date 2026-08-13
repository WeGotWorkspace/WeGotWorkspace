import { Temporal } from "@js-temporal/polyfill";
import type { CalendarEvent as EngineCalendarEvent } from "@/lib/calendar-engine";
import type { JmapCalendarEvent } from "@/lib/jmap-client";
import type { CalendarEventDraft, CalendarEventPatch } from "@/calendar-core/src/calendar-types";

/**
 * Pure form model for the event editor: JSCalendar wire <-> editable fields.
 * Editing a recurring occurrence edits the master series in v1 (per-occurrence
 * exceptions are a documented follow-up alongside drag interactions).
 */

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
  location: string;
  description: string;
};

const DEFAULT_START_TIME = "10:00";
const DEFAULT_DURATION_MINUTES = 60;

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
    location: "",
    description: "",
  };
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
  const allDay = intent.allDay === true;
  const formEnd = allDay ? intent.end.subtract({ days: 1 }) : intent.end;
  return {
    title: intent.title?.trim() ?? "",
    calendarId,
    allDay,
    startDate: intent.start.toPlainDate().toString(),
    startTime: intent.start.toPlainTime().toString({ smallestUnit: "minute" }),
    endDate: formEnd.toPlainDate().toString(),
    endTime: formEnd.toPlainTime().toString({ smallestUnit: "minute" }),
    location: "",
    description: "",
  };
}

function primaryLocationName(event: JmapCalendarEvent): string {
  const locations = event.locations ?? {};
  const key = Object.keys(locations)[0];
  return key ? (locations[key]?.name ?? "") : "";
}

export function calendarEventToForm(event: JmapCalendarEvent): CalendarEventFormValue {
  const allDay = event.showWithoutTime === true;
  const start = Temporal.PlainDateTime.from(event.start);
  const duration = Temporal.Duration.from(event.duration ?? (allDay ? "P1D" : "PT1H"));
  const end = start.add(duration);
  // All-day events span [startDate, endDate); the form shows the inclusive last day.
  const formEnd = allDay ? end.subtract({ days: 1 }) : end;
  return {
    title: event.title ?? "",
    calendarId: Object.keys(event.calendarIds ?? {})[0] ?? "",
    allDay,
    startDate: start.toPlainDate().toString(),
    startTime: start.toPlainTime().toString({ smallestUnit: "minute" }),
    endDate: formEnd.toPlainDate().toString(),
    endTime: formEnd.toPlainTime().toString({ smallestUnit: "minute" }),
    location: primaryLocationName(event),
    description: typeof event.description === "string" ? event.description : "",
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

export function calendarEventFormIsValid(form: CalendarEventFormValue): boolean {
  if (!form.title.trim() || !form.calendarId || !form.startDate || !form.endDate) return false;
  if (!form.allDay && (!form.startTime || !form.endTime)) return false;
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

export function formToDraft(form: CalendarEventFormValue): CalendarEventDraft {
  const start = formStart(form);
  return {
    calendarId: form.calendarId,
    title: form.title.trim(),
    start: start.toString({ smallestUnit: "second" }),
    duration: formDuration(form),
    ...(form.allDay ? { allDay: true } : { timeZone: Temporal.Now.timeZoneId() }),
    ...(form.location.trim() ? { location: form.location.trim() } : {}),
    ...(form.description.trim() ? { description: form.description.trim() } : {}),
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
  if (form.location.trim() !== originalForm.location) patch.location = form.location.trim();
  if (form.description.trim() !== originalForm.description) {
    patch.description = form.description.trim();
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
  const duration = event.data.duration ?? Temporal.Duration.from(allDay ? "P1D" : "PT1H");
  const end = start.add(duration);
  const formEnd = allDay ? end.subtract({ days: 1 }) : end;
  return {
    title: event.data.summary,
    calendarId: event.calendarId ?? "",
    allDay,
    startDate: start.toPlainDate().toString(),
    startTime: start.toPlainTime().toString({ smallestUnit: "minute" }),
    endDate: formEnd.toPlainDate().toString(),
    endTime: formEnd.toPlainTime().toString({ smallestUnit: "minute" }),
    location: event.data.location ?? "",
    description: "",
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
    ...(form.location.trim() ? { location: form.location.trim() } : {}),
    ...(form.description.trim() ? { description: form.description.trim() } : {}),
  };
}
