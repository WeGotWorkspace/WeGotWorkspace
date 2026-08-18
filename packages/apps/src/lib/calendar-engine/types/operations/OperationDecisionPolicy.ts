import type { EventRef } from "./primitives.js";

export type OperationDecisionPolicy = {
  onRecurringUpdate?:
    | "single"
    | "series"
    | ((target: EventRef) => "single" | "series" | "require-decision");
  onRecurringDelete?:
    | "single"
    | "series"
    | ((target: EventRef) => "single" | "series" | "require-decision");
};
