import type { CalendarEvent, CalendarEventData } from "../../../types/event.js";
import type {
  AddExceptionInput,
  ApplyResult,
  DomainEffect,
  EventChange,
  RemoveExceptionInput,
  TimeRangeInput,
} from "../../../types/operations.js";
import type { ReduceContext } from "../reduceContext.js";
import {
  asPendingDeleted,
  asPendingUpdated,
  cloneState,
  normalizeTimeRange,
  resolveKey,
  resolveScopeKeys,
  setUpdated,
  withExcludedRecurrence,
} from "../helpers.js";

export function applyAddException(input: AddExceptionInput, context: ReduceContext): ApplyResult {
  const state = cloneState(context.state);
  const changes: EventChange[] = [];
  const effects: DomainEffect[] = [];
  const key = resolveKey(state, input.target);
  if (!key) {
    effects.push({ type: "warning", code: "target-not-found", message: "Target event not found." });
    return { nextState: state, changes, effects };
  }
  const master = state.get(key);
  if (!master) return { nextState: state, changes, effects };
  const updatedMaster = asPendingUpdated(
    withExcludedRecurrence(master, input.recurrenceId),
    context.trackPending ?? false,
  );
  setUpdated(state, changes, key, updatedMaster);

  const raw = input.event;
  const timeInput: TimeRangeInput =
    "duration" in raw
      ? { start: raw.start, duration: raw.duration }
      : { start: raw.start, end: raw.end };
  const normalized = normalizeTimeRange(timeInput);
  const exceptionKey = `${key}::${input.recurrenceId}`;
  const existing = state.get(exceptionKey);
  let exceptionData: CalendarEventData;
  if ("duration" in raw) {
    const { end: _e, color: _masterColor, ...restMaster } = master.data;
    const mergedColor = raw.color !== undefined ? raw.color : _masterColor;
    exceptionData = {
      ...restMaster,
      summary: raw.summary ?? master.data.summary,
      ...(mergedColor !== undefined && mergedColor !== "" ? { color: mergedColor } : {}),
      location: raw.location ?? master.data.location,
      start: normalized.start,
      duration: raw.duration,
      recurrenceRule: undefined,
    };
  } else {
    const { duration: _d, color: _masterColor, ...restMaster } = master.data;
    const mergedColor = raw.color !== undefined ? raw.color : _masterColor;
    exceptionData = {
      ...restMaster,
      summary: raw.summary ?? master.data.summary,
      ...(mergedColor !== undefined && mergedColor !== "" ? { color: mergedColor } : {}),
      location: raw.location ?? master.data.location,
      start: normalized.start,
      end: normalized.end,
      recurrenceRule: undefined,
    };
  }
  const { data: _masterData, recurrenceId: _mr, isException: _me, ...masterEnvelope } = master;
  const exception: CalendarEvent = {
    ...masterEnvelope,
    calendarId: raw.calendarId ?? master.calendarId,
    accountId: raw.accountId ?? master.accountId,
    recurrenceId: input.recurrenceId,
    isException: true,
    data: exceptionData,
  };
  if (existing) {
    setUpdated(
      state,
      changes,
      exceptionKey,
      asPendingUpdated(exception, context.trackPending ?? false),
    );
  } else {
    const createdException = context.trackPending
      ? {
          ...exception,
          pendingOp: "created" as const,
        }
      : exception;
    state.set(exceptionKey, createdException);
    changes.push({ type: "created", key: exceptionKey, event: createdException });
  }
  return { nextState: state, changes, effects };
}

export function applyRemoveException(
  input: RemoveExceptionInput,
  context: ReduceContext,
): ApplyResult {
  const state = cloneState(context.state);
  const changes: EventChange[] = [];
  const effects: DomainEffect[] = [];
  const key = resolveKey(state, input.target);
  if (!key) {
    effects.push({ type: "warning", code: "target-not-found", message: "Target event not found." });
    return { nextState: state, changes, effects };
  }
  const exception = state.get(key);
  if (!exception) return { nextState: state, changes, effects };
  const recurrenceId = input.recurrenceId ?? exception.recurrenceId;
  if (recurrenceId && (input.options?.asExclusion ?? true) && exception.eventId) {
    const masterKey = resolveScopeKeys(state, key, "series").find((candidate) => {
      const event = state.get(candidate);
      return Boolean(event?.data.recurrenceRule && !event?.recurrenceId);
    });
    if (masterKey) {
      const master = state.get(masterKey);
      if (master) {
        const updatedMaster = asPendingUpdated(
          withExcludedRecurrence(master, recurrenceId),
          context.trackPending ?? false,
        );
        setUpdated(state, changes, masterKey, updatedMaster);
      }
    }
  }
  if (context.trackPending) {
    if (exception.pendingOp === "created") {
      state.delete(key);
      changes.push({ type: "removed", key, before: exception });
    } else {
      const updatedException = asPendingDeleted(exception, true);
      setUpdated(state, changes, key, updatedException);
    }
    return { nextState: state, changes, effects };
  }
  state.delete(key);
  changes.push({ type: "removed", key, before: exception });
  return { nextState: state, changes, effects };
}
