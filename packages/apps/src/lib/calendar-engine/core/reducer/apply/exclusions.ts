import type {
  AddExclusionInput,
  ApplyResult,
  DomainEffect,
  EventChange,
  RemoveExclusionInput,
} from "../../../types/operations.js";
import type { ReduceContext } from "../reduceContext.js";
import {
  asPendingUpdated,
  cloneState,
  resolveKey,
  setUpdated,
  withExcludedRecurrence,
} from "../helpers.js";

export function applyAddExclusion(input: AddExclusionInput, context: ReduceContext): ApplyResult {
  const state = cloneState(context.state);
  const changes: EventChange[] = [];
  const effects: DomainEffect[] = [];
  const key = resolveKey(state, input.target);
  if (!key) {
    effects.push({ type: "warning", code: "target-not-found", message: "Target event not found." });
    return { nextState: state, changes, effects };
  }
  const event = state.get(key);
  if (!event) return { nextState: state, changes, effects };
  const updated = asPendingUpdated(
    withExcludedRecurrence(event, input.recurrenceId),
    context.trackPending ?? false,
  );
  setUpdated(state, changes, key, updated);
  return { nextState: state, changes, effects };
}

export function applyRemoveExclusion(
  input: RemoveExclusionInput,
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
  const event = state.get(key);
  if (!event) return { nextState: state, changes, effects };
  const exclusionDates = new Set(event.data.exclusionDates ?? []);
  exclusionDates.delete(input.recurrenceId);
  const updated = asPendingUpdated(
    { ...event, data: { ...event.data, exclusionDates } },
    context.trackPending ?? false,
  );
  setUpdated(state, changes, key, updated);
  return { nextState: state, changes, effects };
}
