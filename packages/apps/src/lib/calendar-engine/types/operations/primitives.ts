import type { CalendarAccountId } from "../calendar/CalendarAccountId.js";
import type { CalendarId } from "../calendar/CalendarId.js";
import type { CalendarEventsMap } from "../event/index.js";

export type EventsState = CalendarEventsMap;
export type EventKey = string;
export type Scope = "single" | "series";

export type EventRef = {
  eventId: string;
  accountId?: CalendarAccountId;
  calendarId?: CalendarId;
  recurrenceId?: string;
};

export type EventTarget = { key: EventKey } | EventRef;
