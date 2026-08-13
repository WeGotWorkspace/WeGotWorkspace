import type { Calendar } from "./Calendar.js";
import type { CalendarId } from "./CalendarId.js";

/**
 * All calendars keyed by {@link CalendarId} (opaque app id, not the resource URL).
 */
export type CalendarsMap = Map<CalendarId, Calendar>;
