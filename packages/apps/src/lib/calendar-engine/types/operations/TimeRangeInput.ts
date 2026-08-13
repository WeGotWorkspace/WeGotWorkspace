import type { Temporal } from "@js-temporal/polyfill";
import type { CalendarEventTimeSpan } from "../event/CalendarEventTimeSpan.js";

type WithStart<U> = U extends CalendarEventTimeSpan ? { start: Temporal.PlainDateTime } & U : never;

export type TimeRangeInput = WithStart<CalendarEventTimeSpan>;
