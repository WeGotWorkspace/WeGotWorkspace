import type { CalendarEventData } from "./CalendarEventData.js";
import type { CalendarEventEnvelope } from "./CalendarEventEnvelope.js";

export type CalendarEvent = CalendarEventEnvelope & {
  data: CalendarEventData;
};
