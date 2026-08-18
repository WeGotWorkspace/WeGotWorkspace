import type { Calendar } from "../types/calendar/Calendar.js";
import type { CalendarsMap } from "../types/calendar/CalendarsMap.js";
import type { CalendarEventData } from "../types/event/CalendarEventData.js";

/**
 * When an event does not define its own color, the UI uses the parent calendar color.
 * This value is used only when neither an explicit color nor a calendar entry is available.
 */
export const DEFAULT_CALENDAR_EVENT_COLOR = "#94a3b8";

type CalendarColorSource = ReadonlyMap<string, Pick<Calendar, "color">>;

/**
 * Resolves the effective display color: explicit event color, then calendar color, then
 * optional {@link fallbackColor}, then {@link DEFAULT_CALENDAR_EVENT_COLOR}.
 */
export function resolveCalendarEventColor(
  calendarId: string | undefined,
  explicitColor: string | undefined,
  calendars?: CalendarColorSource,
  fallbackColor?: string,
): string {
  if (explicitColor !== undefined && explicitColor !== "") {
    return explicitColor;
  }
  if (calendarId !== undefined && calendars !== undefined) {
    const fromCalendar = calendars.get(calendarId)?.color;
    if (fromCalendar !== undefined && fromCalendar !== "") {
      return fromCalendar;
    }
  }
  if (fallbackColor !== undefined && fallbackColor !== "") {
    return fallbackColor;
  }
  return DEFAULT_CALENDAR_EVENT_COLOR;
}

/**
 * Produces {@link CalendarEventData} with `color` filled from the calendar when omitted.
 */
export function finalizeCalendarEventData<
  T extends Omit<CalendarEventData, "color"> & { color?: string },
>(
  calendarId: string,
  data: T,
  calendars?: CalendarsMap,
  fallbackColor?: string,
): T & { color: string } {
  return {
    ...data,
    color: resolveCalendarEventColor(calendarId, data.color, calendars, fallbackColor),
  };
}
