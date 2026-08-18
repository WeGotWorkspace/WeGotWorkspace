import { isDetachedException } from "../../../utils/recurrence.js";
import type {
  ApplyResult,
  DomainEffect,
  EventChange,
  UpdateInput,
} from "../../../types/operations.js";
import type { ReduceContext } from "../reduceContext.js";
import {
  applyUpdateToEvent,
  asPendingUpdated,
  cloneState,
  resolveKey,
  resolveScopeKeys,
  setUpdated,
} from "../helpers.js";

export function applyUpdate(input: UpdateInput, context: ReduceContext): ApplyResult {
  const state = cloneState(context.state);
  const changes: EventChange[] = [];
  const effects: DomainEffect[] = [];
  const key = resolveKey(state, input.target);
  if (!key) {
    effects.push({ type: "warning", code: "target-not-found", message: "Target event not found." });
    return { nextState: state, changes, effects };
  }
  const keys = resolveScopeKeys(state, key, input.scope);
  for (const updateKey of keys) {
    const event = state.get(updateKey);
    if (!event) continue;
    if (input.scope === "series" && isDetachedException(event)) continue;
    const updated = asPendingUpdated(
      applyUpdateToEvent(event, input.patch),
      context.trackPending ?? false,
    );
    setUpdated(state, changes, updateKey, updated);
  }
  return { nextState: state, changes, effects };
}
