import type { CalendarViewId } from "@/lib/models/calendar-types";

/** Day → Year by time span — list is a presentation toggle, not a dropdown option. */
export const CALENDAR_VIEW_ORDER: CalendarViewId[] = ["day", "week", "month", "year"];
