import type { CalendarRecurrenceFrequency } from "./CalendarRecurrenceFrequency.js";
import type { CalendarRecurrenceTermination } from "./CalendarRecurrenceTermination.js";
import type { CalendarRecurrenceWeekday } from "./CalendarRecurrenceWeekday.js";
import type { CalendarRecurrenceWeekdayRule } from "./CalendarRecurrenceWeekdayRule.js";

export type CalendarRecurrenceRule = {
  freq: CalendarRecurrenceFrequency;
  interval?: number;
  wkst?: CalendarRecurrenceWeekday;
  bySecond?: number[];
  byMinute?: number[];
  byHour?: number[];
  byDay?: CalendarRecurrenceWeekdayRule[];
  byMonthDay?: number[];
  byYearDay?: number[];
  byWeekNo?: number[];
  byMonth?: number[];
  bySetPos?: number[];
} & CalendarRecurrenceTermination;
