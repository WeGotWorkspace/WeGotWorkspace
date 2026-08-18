import { isDetachedException } from "../../../utils/recurrence.js";
import type {
  ApplyResult,
  DomainEffect,
  EventChange,
  RemoveInput,
} from "../../../types/operations.js";
import type { ReduceContext } from "../reduceContext.js";
import {
  asPendingDeleted,
  cloneState,
  resolveKey,
  resolveScopeKeys,
  setUpdated,
  withExcludedRecurrence,
} from "../helpers.js";

export function applyRemove(input: RemoveInput, context: ReduceContext): ApplyResult {
  const state = cloneState(context.state);
  const changes: EventChange[] = [];
  const effects: DomainEffect[] = [];
  const key = resolveKey(state, input.target);
  if (!key) {
    effects.push({ type: "warning", code: "target-not-found", message: "Target event not found." });
    return { nextState: state, changes, effects };
  }
  const keys = resolveScopeKeys(state, key, input.scope);
  if (input.scope === "single") {
    const current = state.get(key);
    if (!current) return { nextState: state, changes, effects };
    if (
      isDetachedException(current) &&
      current.recurrenceId &&
      (input.options?.exceptionAsExclusion ?? true)
    ) {
      const masterKey = resolveScopeKeys(state, key, "series").find((candidate) => {
        const event = state.get(candidate);
        return Boolean(event?.data.recurrenceRule && !event?.recurrenceId);
      });
      if (masterKey) {
        const masterEvent = state.get(masterKey);
        if (masterEvent) {
          const updatedMaster = withExcludedRecurrence(masterEvent, current.recurrenceId);
          setUpdated(state, changes, masterKey, updatedMaster);
        }
      }
    }
    if (context.trackPending) {
      if (current.pendingOp === "created") {
        state.delete(key);
        changes.push({ type: "removed", key, before: current });
      } else {
        const updated = asPendingDeleted(current, true);
        setUpdated(state, changes, key, updated);
      }
      return { nextState: state, changes, effects };
    }

    state.delete(key);
    changes.push({ type: "removed", key, before: current });
    return { nextState: state, changes, effects };
  }
  for (const removeKey of keys) {
    const current = state.get(removeKey);
    if (!current) continue;
    if (context.trackPending) {
      if (current.pendingOp === "created") {
        state.delete(removeKey);
        changes.push({ type: "removed", key: removeKey, before: current });
      } else {
        const updated = asPendingDeleted(current, true);
        setUpdated(state, changes, removeKey, updated);
      }
      continue;
    }
    state.delete(removeKey);
    changes.push({ type: "removed", key: removeKey, before: current });
  }
  return { nextState: state, changes, effects };
}
