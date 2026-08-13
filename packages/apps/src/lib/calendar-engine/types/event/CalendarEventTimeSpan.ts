import type { Temporal } from "@js-temporal/polyfill";

export type CalendarEventTimeSpan =
  | {
      end: Temporal.PlainDateTime;
      duration?: never;
    }
  | {
      duration: Temporal.Duration;
      end?: never;
    };
