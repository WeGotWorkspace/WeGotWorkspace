import { Temporal } from "@js-temporal/polyfill";
import {
  isDetachedException,
  shiftDateValue,
  shiftExclusionDates,
  shiftRecurrenceId,
} from "../../../utils/recurrence.js";
import type { CalendarEvent } from "../../../types/event.js";
import type {
  ApplyResult,
  DomainEffect,
  EventChange,
  MoveInput,
} from "../../../types/operations.js";
import type { ReduceContext } from "../reduceContext.js";
import {
  asPendingUpdated,
  cloneState,
  resolveKey,
  resolveScopeKeys,
  setUpdated,
  withDurationTimeSpan,
  withEndTimeSpan,
} from "../helpers.js";

export function applyMove(input: MoveInput, context: ReduceContext): ApplyResult {
  const state = cloneState(context.state);
  const changes: EventChange[] = [];
  const effects: DomainEffect[] = [];
  const key = resolveKey(state, input.target);
  if (!key) {
    effects.push({ type: "warning", code: "target-not-found", message: "Target event not found." });
    return { nextState: state, changes, effects };
  }
  const keys = resolveScopeKeys(state, key, input.scope);
  const keepExceptionTiming = input.options?.keepExceptionTiming ?? true;
  const shiftExceptionRecurrenceId = input.options?.shiftExceptionRecurrenceId ?? true;
  const shiftExdates = input.options?.shiftExclusionDates ?? true;
  for (const updateKey of keys) {
    const event = state.get(updateKey);
    if (!event) continue;
    const isException = isDetachedException(event);
    if (input.scope === "series" && isException && keepExceptionTiming) {
      const nextRecurrenceId = shiftExceptionRecurrenceId
        ? shiftRecurrenceId(
            event.recurrenceId,
            event.data.allDay ?? false,
            event.data.start,
            input.delta,
          )
        : event.recurrenceId;
      const updated: CalendarEvent = {
        ...event,
        recurrenceId: nextRecurrenceId,
      };
      setUpdated(state, changes, updateKey, updated);
      continue;
    }
    const updated = asPendingUpdated(
      (() => {
        const { data } = event;
        const shiftedStart = shiftDateValue(data.start, input.delta);
        const nextExclusionDates = shiftExdates
          ? shiftExclusionDates(event, input.delta)
          : data.exclusionDates;
        if ("end" in data && data.end !== undefined) {
          const partial: CalendarEvent = {
            ...event,
            data: {
              ...data,
              start: shiftedStart,
              exclusionDates: nextExclusionDates,
            },
          };
          return withEndTimeSpan(partial, shiftDateValue(data.end, input.delta));
        }
        const partial: CalendarEvent = {
          ...event,
          data: {
            ...data,
            start: shiftedStart,
            exclusionDates: nextExclusionDates,
          },
        };
        return withDurationTimeSpan(partial, data.duration as Temporal.Duration);
      })(),
      context.trackPending ?? false,
    );
    setUpdated(state, changes, updateKey, updated);
  }
  return { nextState: state, changes, effects };
}
