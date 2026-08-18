import { Temporal } from "@js-temporal/polyfill";
import type { CalendarEvent, CalendarEventsMap } from "../../types/event.js";
import type {
  AddExceptionInput,
  AddExclusionInput,
  ApplyResult,
  CreateInput,
  EventOperation,
  EventTarget,
  MoveInput,
  RemoveExceptionInput,
  RemoveExclusionInput,
  RemoveInput,
  ResizeEndInput,
  ResizeStartInput,
  UpdateInput,
} from "../../types/operations.js";
import { expandEvents } from "../expandEvents.js";
import { applyOperation } from "./apply/index.js";
import { cloneEvent, cloneState, resolveKey } from "./helpers.js";

export class EventsAPI {
  #state: CalendarEventsMap;
  #timezone?: string;
  #trackPending = false;

  constructor(
    events: CalendarEventsMap,
    options: { timezone?: string; trackPending?: boolean } = {},
  ) {
    this.#state = cloneState(events);
    this.#timezone = options.timezone;
    this.#trackPending = options.trackPending ?? false;
  }

  get events(): CalendarEventsMap {
    return cloneState(this.#state);
  }

  get(target: EventTarget): CalendarEvent | undefined {
    const key = resolveKey(this.#state, target);
    if (!key) return undefined;
    const event = this.#state.get(key);
    return event ? cloneEvent(event) : undefined;
  }

  expand(range: { start: Temporal.PlainDateTime; end: Temporal.PlainDateTime }): CalendarEventsMap {
    return expandEvents(this.#state, range, { timezone: this.#timezone });
  }

  create(input: CreateInput): ApplyResult {
    return this.apply({ type: "create", input });
  }

  update(input: UpdateInput): ApplyResult {
    return this.apply({ type: "update", input });
  }

  move(input: MoveInput): ApplyResult {
    return this.apply({ type: "move", input });
  }

  resizeStart(input: ResizeStartInput): ApplyResult {
    return this.apply({ type: "resize-start", input });
  }

  resizeEnd(input: ResizeEndInput): ApplyResult {
    return this.apply({ type: "resize-end", input });
  }

  remove(input: RemoveInput): ApplyResult {
    return this.apply({ type: "remove", input });
  }

  addExclusion(input: AddExclusionInput): ApplyResult {
    return this.apply({ type: "add-exclusion", input });
  }

  removeExclusion(input: RemoveExclusionInput): ApplyResult {
    return this.apply({ type: "remove-exclusion", input });
  }

  addException(input: AddExceptionInput): ApplyResult {
    return this.apply({ type: "add-exception", input });
  }

  removeException(input: RemoveExceptionInput): ApplyResult {
    return this.apply({ type: "remove-exception", input });
  }

  apply(operation: EventOperation): ApplyResult {
    const result = applyOperation(operation, {
      state: this.#state,
      timezone: this.#timezone,
      trackPending: this.#trackPending,
    });
    this.#state = cloneState(result.nextState);
    return {
      ...result,
      nextState: cloneState(result.nextState),
    };
  }
}
