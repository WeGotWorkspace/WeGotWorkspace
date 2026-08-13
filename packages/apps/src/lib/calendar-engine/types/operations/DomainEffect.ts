import type { EventRef } from "./primitives.js";

export type DomainEffect =
  | { type: "warning"; code: string; message: string }
  | { type: "decision-required"; decision: "single-or-series"; target: EventRef };
