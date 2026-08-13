import { Temporal } from "@js-temporal/polyfill";
import type { CalendarEvent } from "../../types/event.js";
import { shiftDateValue, toPlainDateTime } from "../../utils/recurrence.js";
import type {
  EventChange,
  EventTarget,
  EventsState,
  Scope,
  TimeRangeInput,
  UpdateInput,
} from "../../types/operations.js";

export function cloneEvent(event: CalendarEvent): CalendarEvent {
  return {
    ...event,
    data: {
      ...event.data,
      exclusionDates: event.data.exclusionDates ? new Set(event.data.exclusionDates) : undefined,
    },
  };
}

export function cloneState(state: EventsState): EventsState {
  return new Map(Array.from(state.entries()).map(([key, event]) => [key, cloneEvent(event)]));
}

export function normalizeTimeRange(input: TimeRangeInput): {
  start: Temporal.PlainDateTime;
  end: Temporal.PlainDateTime;
} {
  if ("duration" in input && input.duration !== undefined) {
    return { start: input.start, end: shiftDateValue(input.start, input.duration) };
  }
  return { start: input.start, end: input.end };
}

export function withEndTimeSpan(event: CalendarEvent, end: Temporal.PlainDateTime): CalendarEvent {
  const { end: _e, duration: _d, ...dataRest } = event.data;
  return { ...event, data: { ...dataRest, end } };
}

export function withDurationTimeSpan(
  event: CalendarEvent,
  duration: Temporal.Duration,
): CalendarEvent {
  const { end: _e, duration: _d, ...dataRest } = event.data;
  return { ...event, data: { ...dataRest, duration } };
}

function eventMatchesCalendarRef(
  event: CalendarEvent,
  ref: { calendarId?: string; accountId?: string },
): boolean {
  if (ref.calendarId !== undefined && event.calendarId !== ref.calendarId) return false;
  if (ref.accountId !== undefined && event.accountId !== ref.accountId) return false;
  return true;
}

export function resolveKey(state: EventsState, target: EventTarget): string | undefined {
  if ("key" in target) return state.has(target.key) ? target.key : undefined;
  for (const [key, event] of state.entries()) {
    if (event.eventId !== target.eventId) continue;
    if (!eventMatchesCalendarRef(event, target)) continue;
    if (target.recurrenceId === undefined || event.recurrenceId === target.recurrenceId) return key;
  }
  if (target.recurrenceId !== undefined) return undefined;
  for (const [key, event] of state.entries()) {
    if (event.eventId !== target.eventId) continue;
    if (!eventMatchesCalendarRef(event, target)) continue;
    if (!event.recurrenceId) return key;
  }
  return undefined;
}

export function resolveScopeKeys(state: EventsState, key: string, scope: Scope): string[] {
  if (scope === "single") return [key];
  const source = state.get(key);
  if (!source?.eventId) return [key];
  const keys: string[] = [];
  for (const [candidateKey, event] of state.entries()) {
    if (event.eventId !== source.eventId) continue;
    if (!eventMatchesCalendarRef(event, source)) continue;
    keys.push(candidateKey);
  }
  return keys;
}

export function changeUpdated(
  changes: EventChange[],
  key: string,
  before: CalendarEvent,
  after: CalendarEvent,
) {
  changes.push({ type: "updated", key, before, after });
}

export function setUpdated(
  state: EventsState,
  changes: EventChange[],
  key: string,
  update: CalendarEvent,
) {
  const before = state.get(key);
  if (!before) return;
  state.set(key, update);
  changeUpdated(changes, key, before, update);
}

export function asPendingUpdated(event: CalendarEvent, trackPending: boolean): CalendarEvent {
  if (!trackPending) return event;
  return {
    ...event,
    pendingOp: event.pendingOp === "created" ? "created" : "updated",
  };
}

export function asPendingDeleted(event: CalendarEvent, trackPending: boolean): CalendarEvent {
  if (!trackPending) return event;
  return {
    ...event,
    pendingOp: "deleted",
  };
}

export function withExcludedRecurrence(event: CalendarEvent, recurrenceId: string): CalendarEvent {
  const exclusionDates = new Set(event.data.exclusionDates ?? []);
  exclusionDates.add(recurrenceId);
  return {
    ...event,
    data: { ...event.data, exclusionDates },
    pendingOp: event.pendingOp === "created" ? "created" : "updated",
  };
}

export function ensureMinimumDuration(
  start: Temporal.PlainDateTime,
  end: Temporal.PlainDateTime,
  minDuration: Temporal.Duration | undefined,
): { start: Temporal.PlainDateTime; end: Temporal.PlainDateTime } {
  if (!minDuration) return { start, end };
  const startDT = toPlainDateTime(start);
  const endDT = toPlainDateTime(end);
  const minEnd = startDT.add(minDuration);
  if (Temporal.PlainDateTime.compare(endDT, minEnd) >= 0) return { start, end };
  return { start, end: shiftDateValue(start, minDuration) };
}

export function applyUpdateToEvent(
  event: CalendarEvent,
  patch: UpdateInput["patch"],
): CalendarEvent {
  const { data: prevData, ...envelopeRest } = event;
  const envelope = { ...envelopeRest };
  const nextData = { ...prevData };
  if (patch.summary !== undefined) nextData.summary = patch.summary;
  if (patch.color !== undefined) {
    if (patch.color === "") {
      delete nextData.color;
    } else {
      nextData.color = patch.color;
    }
  }
  if (patch.location !== undefined) nextData.location = patch.location;
  if (patch.allDay !== undefined) nextData.allDay = patch.allDay;
  if (patch.timeZone !== undefined) nextData.timeZone = patch.timeZone;
  if (patch.calendarId !== undefined) envelope.calendarId = patch.calendarId;
  if (patch.accountId !== undefined) envelope.accountId = patch.accountId;
  if (patch.start !== undefined) nextData.start = patch.start;
  let next: CalendarEvent = { ...envelope, data: nextData };
  if ("end" in patch && patch.end !== undefined) {
    next = withEndTimeSpan(next, patch.end);
  }
  if ("duration" in patch && patch.duration !== undefined && patch.start !== undefined) {
    next = withDurationTimeSpan(next, patch.duration);
  } else if ("duration" in patch && patch.duration !== undefined) {
    next = withDurationTimeSpan(next, patch.duration);
  }
  return next;
}
