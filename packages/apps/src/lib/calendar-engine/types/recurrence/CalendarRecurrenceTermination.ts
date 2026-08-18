import type { Temporal } from "@js-temporal/polyfill";

export type CalendarRecurrenceTermination =
  | { until: Temporal.PlainDateTime; count?: never }
  | { count: number; until?: never }
  | { until?: never; count?: never };
