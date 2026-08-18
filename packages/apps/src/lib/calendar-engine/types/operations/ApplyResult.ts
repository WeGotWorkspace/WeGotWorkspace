import type { EventChange } from "./EventChange.js";
import type { DomainEffect } from "./DomainEffect.js";
import type { EventsState } from "./primitives.js";

export type ApplyResult = {
  nextState: EventsState;
  changes: EventChange[];
  effects: DomainEffect[];
};
