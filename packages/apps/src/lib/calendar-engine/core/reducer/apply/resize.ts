import {
  isDetachedException,
  resolveEventEnd,
  shiftDateValue,
  shiftExclusionDates,
  shiftRecurrenceId,
  toPlainDateTime,
} from "../../../utils/recurrence.js";
import type { CalendarEvent } from "../../../types/event.js";
import type {
  ApplyResult,
  DomainEffect,
  EventChange,
  ResizeEndInput,
  ResizeStartInput,
} from "../../../types/operations.js";
import type { ReduceContext } from "../reduceContext.js";
import {
  asPendingUpdated,
  cloneState,
  ensureMinimumDuration,
  resolveKey,
  resolveScopeKeys,
  setUpdated,
  withEndTimeSpan,
} from "../helpers.js";

export function applyResizeStart(input: ResizeStartInput, context: ReduceContext): ApplyResult {
  const state = cloneState(context.state);
  const changes: EventChange[] = [];
  const effects: DomainEffect[] = [];
  const key = resolveKey(state, input.target);
  if (!key) {
    effects.push({ type: "warning", code: "target-not-found", message: "Target event not found." });
    return { nextState: state, changes, effects };
  }
  const referenceEvent = state.get(key);
  if (!referenceEvent) return { nextState: state, changes, effects };
  const keys = resolveScopeKeys(state, key, input.scope);
  const seriesDelta =
    input.scope === "series"
      ? toPlainDateTime(referenceEvent.data.start).until(toPlainDateTime(input.toStart))
      : null;
  for (const updateKey of keys) {
    const event = state.get(updateKey);
    if (!event) continue;
    if (input.scope === "series" && isDetachedException(event)) {
      const updatedException: CalendarEvent = {
        ...event,
        recurrenceId: shiftRecurrenceId(
          event.recurrenceId,
          event.data.allDay ?? false,
          event.data.start,
          seriesDelta,
        ),
      };
      setUpdated(state, changes, updateKey, updatedException);
      continue;
    }
    const nextStart =
      input.scope === "series" ? shiftDateValue(event.data.start, seriesDelta) : input.toStart;
    const bounded = ensureMinimumDuration(
      nextStart,
      resolveEventEnd(event.data),
      input.options?.minDuration,
    );
    const nextExclusionDates =
      input.scope === "series" && event.data.recurrenceRule && !event.recurrenceId
        ? shiftExclusionDates(event, seriesDelta)
        : event.data.exclusionDates;
    const updated = asPendingUpdated(
      withEndTimeSpan(
        {
          ...event,
          data: {
            ...event.data,
            start: bounded.start,
            exclusionDates: nextExclusionDates,
          },
        },
        bounded.end,
      ),
      context.trackPending ?? false,
    );
    setUpdated(state, changes, updateKey, updated);
  }
  return { nextState: state, changes, effects };
}

export function applyResizeEnd(input: ResizeEndInput, context: ReduceContext): ApplyResult {
  const state = cloneState(context.state);
  const changes: EventChange[] = [];
  const effects: DomainEffect[] = [];
  const key = resolveKey(state, input.target);
  if (!key) {
    effects.push({ type: "warning", code: "target-not-found", message: "Target event not found." });
    return { nextState: state, changes, effects };
  }
  const referenceEvent = state.get(key);
  if (!referenceEvent) return { nextState: state, changes, effects };
  const keys = resolveScopeKeys(state, key, input.scope);
  const seriesDelta =
    input.scope === "series"
      ? toPlainDateTime(resolveEventEnd(referenceEvent.data)).until(toPlainDateTime(input.toEnd))
      : null;
  for (const updateKey of keys) {
    const event = state.get(updateKey);
    if (!event) continue;
    if (input.scope === "series" && isDetachedException(event)) continue;
    const nextEnd =
      input.scope === "series"
        ? shiftDateValue(resolveEventEnd(event.data), seriesDelta)
        : input.toEnd;
    const bounded = ensureMinimumDuration(event.data.start, nextEnd, input.options?.minDuration);
    const updated = asPendingUpdated(
      withEndTimeSpan(
        {
          ...event,
          data: { ...event.data, start: bounded.start },
        },
        bounded.end,
      ),
      context.trackPending ?? false,
    );
    setUpdated(state, changes, updateKey, updated);
  }
  return { nextState: state, changes, effects };
}
