import type { EventsState } from "../../types/operations.js";

export type ReduceContext = {
  state: EventsState;
  timezone?: string;
  trackPending?: boolean;
};
