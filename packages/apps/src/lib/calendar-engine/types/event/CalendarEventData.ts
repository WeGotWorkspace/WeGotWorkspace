import type { Temporal } from "@js-temporal/polyfill";
import type { IANATimeZone } from "./timezone.js";
import type { CalendarExclusionDates, CalendarRecurrenceRule } from "../recurrence/index.js";
import type { CalendarEventTimeSpan } from "./CalendarEventTimeSpan.js";

export type CalendarEventData = {
  start: Temporal.PlainDateTime;
  allDay?: boolean;
  timeZone?: IANATimeZone;
  summary: string;
  /** When omitted or empty, consumers resolve display color from the parent calendar. */
  color?: string;
  location?: string;
  /** True when the event carries a meeting URL (the dedicated link, not text in the notes). */
  hasMeeting?: boolean;
  recurrenceRule?: CalendarRecurrenceRule;
  exclusionDates?: CalendarExclusionDates;
} & CalendarEventTimeSpan;
