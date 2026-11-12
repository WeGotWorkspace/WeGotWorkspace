import type { CalendarInfo } from "@/lib/models/calendar-types";
import { calendarHiddenCalendars } from "@/calendar-core/src/calendar-view-prefs";
import { useHiddenCollectionIds } from "@/collection-sidebar/src/use-hidden-collection-ids";

/** Device-local hidden-calendar set. Persist lives here so the controller stays an orchestrator. */
export function useCalendarHiddenIds(calendars: ReadonlyArray<CalendarInfo>) {
  const { hiddenIds, setHiddenIds } = useHiddenCollectionIds(calendars, calendarHiddenCalendars);
  return { hiddenCalendarIds: hiddenIds, setHiddenCalendarIds: setHiddenIds };
}
